import express from "express";
import cors from "cors";
import "dotenv/config";

import path from "path";
import { fileURLToPath } from "url";
import {
  getAccessToken,
  getCaptureDetails,
  getRefund,
  createOrder,
  getOrder,
  updateOrderShipping,
  captureOrder,
  refundCapture,
  listTransactions,
} from "./paypal.js";

const app = express();
app.use(cors());
app.use(express.json());

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

app.get("/", (req, res) => {
  res.sendFile(path.join(CLIENT_DIR, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
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
  }),
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
  }),
);

app.get(
  "/api/admin/captures/:captureId/refunds",
  asyncHandler(async (req, res) => {
    const { captureId } = req.params;

    const { data: cap, debugId } = await getCaptureDetails(captureId);
    const captureStatus = cap?.status || null;
    const captureAmount = cap?.amount?.value || null;
    const captureCurrency = cap?.amount?.currency_code || null;

    const refundLink = (cap.links || []).find((l) => l.rel === "refund")?.href;

    if (!refundLink) {
      return res.json({
        ok: true,
        debugId,
        refunds: [],
        captureStatus,
        captureAmount,
        captureCurrency,
      });
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
        return res.json({
          ok: true,
          debugId: refundsDebugId || debugId,
          refunds: [],
          captureStatus,
          captureAmount,
          captureCurrency,
        });
      }

      return res.status(r.status).json({
        error: "Failed to fetch refunds from PayPal",
        debugId: refundsDebugId,
        details: refundsData,
      });
    }

    res.json({
      ok: true,
      debugId: refundsDebugId || debugId,
      refunds: refundsData,
      captureStatus,
      captureAmount,
      captureCurrency,
    });
  }),
);

function normalizeAmount(amount) {
  if (amount === undefined || amount === "") return null;
  if (amount === null)
    return { error: "Amount cannot be null. Leave empty for full refund or provide a value > 0." };
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
  }),
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
  }),
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
  }),
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
  }),
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
  }),
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
  }),
);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
