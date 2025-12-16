import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// Load .env ONLY in local/dev environments.
// On Render, use Environment Variables (no .env file).
if (!process.env.RENDER && process.env.NODE_ENV !== "production") {
  const dotenv = await import("dotenv");
  dotenv.config();
}

import {
  getAccessToken,
  getCaptureDetails,
  getRefund,
  verifyWebhookSignature,
  createOrder,
  getOrder,
  updateOrderShipping,
  captureOrder,
  refundCapture,
  listTransactions,
} from "./paypal.js";

// In-memory webhook snapshots (kept simple; reset on restart)
const webhookRefunds = new Map(); // captureId -> { captureId, total, currency, status, updatedAt }
const webhookCaptures = new Map(); // captureId -> { captureId, orderID, status, amount, currency, createdAt, updatedAt }

const app = express();
app.use(cors());

// Optional: Log webhook hits early (helps debugging on Render)
app.use((req, _res, next) => {
  if (req.path.startsWith("/api/webhooks/paypal")) {
    console.log("[REQ]", req.method, req.path, new Date().toISOString());
  }
  next();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function sendError(res, err) {
  const status = err.status || 500;
  const payload = {
    error: err.message || "Internal error",
    debugId: err.debugId,
    details: err.data,
  };
  if (err.hint) payload.hint = err.hint;

  if (status >= 500) {
    console.error("[server] error", {
      message: err.message,
      status,
      debugId: err.debugId,
      details: err.data,
    });
  }
  res.status(status).json(payload);
}

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => sendError(res, err));

const CLIENT_DIR = path.join(__dirname, "../client");
app.use(express.static(CLIENT_DIR));

// Raw body needed for webhook signature verification
app.use("/api/webhooks/paypal", express.raw({ type: "application/json" }));

// JSON parser for all other routes
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(CLIENT_DIR, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ ok: true, env: process.env.RENDER ? "render" : "local" });
});

app.get(
  "/api/admin/refunds/:refundId",
  asyncHandler(async (req, res) => {
    const { refundId } = req.params;

    const { data, debugId } = await getRefund(refundId).catch((err) => {
      if ((err.status || 0) === 403) {
        err.hint =
          "Transaction Search is not enabled for these PayPal sandbox credentials. Enable the Reporting/Transaction Search permission in the PayPal Developer app, then try again.";
      }
      throw err;
    });

    res.json({ ok: true, debugId, refund: data });
  })
);

app.get(
  "/api/admin/captures/:captureId",
  asyncHandler(async (req, res) => {
    const { captureId } = req.params;
    const { data, debugId } = await getCaptureDetails(captureId);

    const capture = {
      captureId: data?.id || captureId,
      status: data?.status || null,
      amount: data?.amount?.value || null,
      currency: data?.amount?.currency_code || null,
      createTime: data?.create_time || data?.update_time || null,
      orderID: data?.supplementary_data?.related_ids?.order_id || null,
      payerEmail: data?.payer_email || null,
      debugId,
      raw: data,
    };

    res.json({ ok: true, debugId, capture });
  })
);

// Helper: fetch refunds for a capture (used by API + webhook)
async function fetchCaptureRefunds(captureId) {
  let cap;
  let debugId;
  try {
    const r = await getCaptureDetails(captureId);
    cap = r.data;
    debugId = r.debugId;
  } catch (e) {
    if ((e.status || 0) === 404) {
      return { refunds: [], captureStatus: null, captureAmount: null, captureCurrency: null, debugId: e.debugId };
    }
    throw e;
  }
  const captureStatus = cap?.status || null;
  const captureAmount = cap?.amount?.value || null;
  const captureCurrency = cap?.amount?.currency_code || null;
  const refundLink = (cap.links || []).find((l) => l.rel === "refund")?.href;

  if (!refundLink) {
    return { refunds: [], captureStatus, captureAmount, captureCurrency, debugId };
  }

  const token = await getAccessToken();
  const r = await fetch(refundLink, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });

  const refundsData = await r.json().catch(() => ({}));
  const refundsDebugId = r.headers.get("paypal-debug-id");

  if (!r.ok) {
    if (r.status === 404 || r.status === 400 || r.status === 422) {
      return {
        refunds: [],
        captureStatus,
        captureAmount,
        captureCurrency,
        debugId: refundsDebugId || debugId,
      };
    }
    const err = new Error("Failed to fetch refunds from PayPal");
    err.status = r.status;
    err.debugId = refundsDebugId;
    err.data = refundsData;
    throw err;
  }

  return {
    refunds: refundsData,
    captureStatus,
    captureAmount,
    captureCurrency,
    debugId: refundsDebugId || debugId,
  };
}

app.get(
  "/api/admin/captures/:captureId/refunds",
  asyncHandler(async (req, res) => {
    const { captureId } = req.params;
    const data = await fetchCaptureRefunds(captureId);
    res.json({ ok: true, ...data });
  })
);

function normalizeAmount(amount) {
  if (amount === undefined || amount === "") return null;
  if (amount === null) {
    return { error: "Amount cannot be null. Leave empty for full refund or provide a value > 0." };
  }

  const s = String(amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    return { error: "Invalid amount format. Use e.g. 5.00" };
  }

  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) {
    return { error: "Amount must be > 0" };
  }

  return { value: n.toFixed(2) };
}

app.post(
  "/api/orders",
  asyncHandler(async (req, res) => {
    const { currency = "USD", amount = "10.00", sku, name, buyerInfo } = req.body || {};

    const { data, debugId } = await createOrder({ currency, amount, buyerInfo });

    res.status(201).json({
      orderID: data.id,
      status: data.status,
      debugId,
      meta: { sku, name },
      raw: data,
    });
  })
);

app.get(
  "/api/orders/:orderID",
  asyncHandler(async (req, res) => {
    const { orderID } = req.params;
    const { data, debugId } = await getOrder(orderID);

    const pu = data.purchase_units?.[0];
    const shipping = pu?.shipping;
    const address = shipping?.address;

    res.json({
      debugId,
      order: data,
      shipping: shipping || null,
      address: address || null,
    });
  })
);

app.patch(
  "/api/orders/:orderID",
  asyncHandler(async (req, res) => {
    const { orderID } = req.params;
    const { currency = "USD", itemTotal, shippingValue } = req.body || {};

    if (!itemTotal || !shippingValue) {
      return res.status(400).json({
        error:
          'Missing itemTotal or shippingValue. Example: { "itemTotal":"10.00", "shippingValue":"4.99" }',
      });
    }

    const { data, debugId } = await updateOrderShipping({
      orderID,
      currency,
      itemTotal,
      shippingValue,
    });

    res.json({ ok: true, debugId, raw: data });
  })
);

app.post(
  "/api/orders/:orderID/capture",
  asyncHandler(async (req, res) => {
    const { orderID } = req.params;
    const { data, debugId } = await captureOrder(orderID);

    const pu = data.purchase_units?.[0];
    const capture = pu?.payments?.captures?.[0];

    res.json({
      ok: true,
      debugId,
      status: data.status,
      captureId: capture?.id || null,
      raw: data,
    });
  })
);

app.get(
  "/api/admin/transactions",
  asyncHandler(async (req, res) => {
    const { start, end, pageSize } = req.query || {};

    const now = new Date();
    const endDate = end ? new Date(end) : now;
    const startDate = start ? new Date(start) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const { data, debugId } = await listTransactions({
      startDate,
      endDate,
      pageSize,
    });

    const txs = data.transaction_details || [];

    const normalized = txs.map((t) => {
      const info = t.transaction_info || {};
      const payer = t.payer_info || {};
      const amount = info.transaction_amount || {};
      const captureId = info.transaction_id || null;

      return {
        orderID: info.paypal_reference_id || null,
        captureId,
        status: info.transaction_status || null,
        amount: amount.value || null,
        currency: amount.currency_code || null,
        createTime: info.transaction_initiation_date || null,
        payerEmail: payer.email_address || null,
        eventCode: info.transaction_event_code || null,
        debugId,
        raw: info,
      };
    });

    res.json({ ok: true, count: normalized.length, transactions: normalized, debugId });
  })
);

app.post(
  "/api/admin/refunds",
  asyncHandler(async (req, res) => {
    const { captureId, amount } = req.body || {};
    if (!captureId) {
      return res.status(400).json({ error: "Missing captureId" });
    }

    const parsedAmount = normalizeAmount(amount);
    if (parsedAmount && parsedAmount.error) {
      return res.status(400).json({ error: parsedAmount.error });
    }

    const { data, debugId } = await refundCapture({
      captureId,
      amount: parsedAmount ? parsedAmount.value : undefined,
    });

    res.json({
      ok: true,
      debugId,
      refundId: data.id,
      refund: data,
    });
  })
);

// Webhook receiver (PayPal)
app.post(
  "/api/webhooks/paypal",
  asyncHandler(async (req, res) => {
    const now = new Date().toISOString();

    // Parse raw body (Buffer) safely
    const rawBody = req.body; // Buffer
    const bodyString = rawBody instanceof Buffer ? rawBody.toString("utf8") : "";
    let body = {};
    try {
      body = JSON.parse(bodyString || "{}");
    } catch {
      console.warn("[WEBHOOK] invalid JSON body");
      return res.sendStatus(200);
    }

    // Extract PayPal signature headers
    const headers = req.headers || {};
    const authAlgo = headers["paypal-auth-algo"];
    const certUrl = headers["paypal-cert-url"];
    const transmissionId = headers["paypal-transmission-id"];
    const transmissionSig = headers["paypal-transmission-sig"];
    const transmissionTime = headers["paypal-transmission-time"];

    console.log("[WEBHOOK] received", {
      time: now,
      event_type: body?.event_type,
      event_id: body?.id,
      hasPayPalHeaders: !!(transmissionId && transmissionSig && transmissionTime),
    });

    // If missing PayPal headers, it's a manual test (curl), not a real webhook.
    const missing = [];
    if (!authAlgo) missing.push("paypal-auth-algo");
    if (!certUrl) missing.push("paypal-cert-url");
    if (!transmissionId) missing.push("paypal-transmission-id");
    if (!transmissionSig) missing.push("paypal-transmission-sig");
    if (!transmissionTime) missing.push("paypal-transmission-time");

    if (missing.length) {
      console.log("[WEBHOOK] missing headers => skip verification", missing);
      return res.status(200).json({ ok: true, skippedVerification: true, missing });
    }

    // Verify signature only when headers are present (real PayPal webhook)
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      console.error("[WEBHOOK] PAYPAL_WEBHOOK_ID is not configured (Render env var missing)");
      // Acknowledge anyway to avoid PayPal retry storms
      return res.status(200).json({ ok: true, warning: "PAYPAL_WEBHOOK_ID missing" });
    }

    const { data: verification } = await verifyWebhookSignature({
      authAlgo,
      certUrl,
      transmissionId,
      transmissionSig,
      transmissionTime,
      webhookId,
      body,
    });

    const vStatus = verification?.verification_status;
    console.log("[WEBHOOK] verification_status=", vStatus);

    if (vStatus !== "SUCCESS") {
      console.warn("[WEBHOOK] signature not verified");
      return res.status(200).json({ ok: true, notVerified: true });
    }

    // ✅ VERIFIED: handle events
    const eventType = body.event_type;
    const resource = body.resource || {};

    const captureId =
      resource.id ||
      resource.capture_id ||
      resource?.supplementary_data?.related_ids?.capture_id ||
      null;

    const status = (resource.status || "").toUpperCase();
    const amount =
      resource.amount?.value ??
      resource.seller_receivable_breakdown?.gross_amount?.value ??
      null;

    const currency =
      resource.amount?.currency_code ??
      resource.seller_receivable_breakdown?.gross_amount?.currency_code ??
      "USD";

    // Capture completed/denied events
    if (
      (eventType === "PAYMENT.CAPTURE.COMPLETED" || eventType === "PAYMENT.CAPTURE.DENIED") &&
      captureId
    ) {
      webhookCaptures.set(captureId, {
        captureId,
        orderID: resource?.supplementary_data?.related_ids?.order_id || null,
        status,
        amount: amount != null ? Math.abs(Number(amount)) : null,
        currency,
        createdAt: resource.create_time || now,
        updatedAt: now,
      });

      console.log("[WEBHOOK] stored capture snapshot", captureId);
      return res.sendStatus(200);
    }

    // Refund events
    if (
      (eventType === "PAYMENT.CAPTURE.REFUNDED" || eventType === "PAYMENT.CAPTURE.PARTIALLY_REFUNDED") &&
      captureId
    ) {
      let refundsTotal = null;
      const refundId = resource?.id || resource?.refund_id || null;

      try {
        const refundsData = await fetchCaptureRefunds(captureId);
        const refunds =
          refundsData.refunds?.refunds ||
          refundsData.refunds?.items ||
          refundsData.refunds ||
          [];

        refundsTotal = refunds.reduce((s, r) => s + Math.abs(Number(r.amount?.value || 0)), 0);
        // If PayPal returns no refund list yet, try webhook payload, then refund detail.
        if (refundsTotal == null || refundsTotal <= 0) {
          if (amount != null) {
            refundsTotal = Math.abs(Number(amount));
          } else if (refundId) {
            try {
              const { data: refundDetail } = await getRefund(refundId);
              const val = refundDetail?.amount?.value;
              if (val != null) refundsTotal = Math.abs(Number(val));
            } catch (detailErr) {
              console.warn("[WEBHOOK] getRefund fallback failed", detailErr?.message || detailErr);
            }
          }
        }

        webhookRefunds.set(captureId, {
          captureId,
          total: refundsTotal,
          currency: refundsData.captureCurrency || currency,
          status: refundsData.captureStatus || status,
          refundId: refundId || null,
          updatedAt: now,
        });

        console.log("[WEBHOOK] stored refund snapshot", captureId, "total=", refundsTotal);
      } catch (e) {
        console.warn("[WEBHOOK] fetchCaptureRefunds failed; storing minimal refund info", e?.message || e);
        webhookRefunds.set(captureId, {
          captureId,
          total: amount ? Math.abs(Number(amount)) : null,
          currency,
          status,
          refundId: refundId || null,
          updatedAt: now,
        });
      }

      return res.sendStatus(200);
    }

    console.log("[WEBHOOK] ignored event", eventType);
    return res.sendStatus(200);
  })
);

// Read webhook snapshot for a capture (refunds)
app.get(
  "/api/admin/webhooks/refunds/:captureId",
  asyncHandler(async (req, res) => {
    const { captureId } = req.params;
    const entry = webhookRefunds.get(captureId);
    res.json({ ok: true, data: entry || null });
  })
);

// Read webhook capture snapshot (real-time capture events)
app.get(
  "/api/admin/webhooks/captures/:captureId",
  asyncHandler(async (req, res) => {
    const { captureId } = req.params;
    const entry = webhookCaptures.get(captureId);
    res.json({ ok: true, data: entry || null });
  })
);

// List all webhook capture snapshots (real-time captures)
app.get(
  "/api/admin/webhooks/captures",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, data: Array.from(webhookCaptures.values()) });
  })
);

// List all webhook refund snapshots (real-time refunds)
app.get(
  "/api/admin/webhooks/refunds",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, data: Array.from(webhookRefunds.values()) });
  })
);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
