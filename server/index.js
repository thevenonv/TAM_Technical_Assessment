import express from "express";
import cors from "cors";
import "dotenv/config";

import path from "path";
import { fileURLToPath } from "url";
import { getCaptureDetails, getRefund } from "./paypal.js"; // getRefund si tu l'as déjà

import {
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

// Serve client static
const CLIENT_DIR = path.join(__dirname, "../client");
app.use(express.static(CLIENT_DIR));

/**
 * ✅ Fix "Cannot GET /"
 * Force / to serve client/index.html
 */
app.get("/", (req, res) => {
  res.sendFile(path.join(CLIENT_DIR, "index.html"));
});

/**
 * Health check
 */
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/admin/refunds/:refundId", basicAuthAdmin, async (req, res) => {
  try {
    const { refundId } = req.params;
    const { data, debugId } = await getRefund(refundId);
    res.json({ ok: true, debugId, refund: data });
  } catch (e) {
    const status = e.status || 500;
    const body = {
      error: e.message,
      debugId: e.debugId,
      details: e.data,
    };

    // PayPal returns 403/NOT_AUTHORIZED when the Transaction Search (reporting)
    // permission is not enabled on the app. Surface a clearer hint to the UI.
    if (status === 403) {
      body.hint =
        "Transaction Search n'est pas activé pour ces credentials PayPal (sandbox). Active la permission Reporting/Transaction Search dans l'app PayPal Developer, puis réessaie.";
    }

    res.status(status).json(body);
  }
});

app.get("/api/admin/captures/:captureId/refunds", basicAuthAdmin, async (req, res) => {
  try {
    const { captureId } = req.params;

    // 1) Fetch capture details
    const { data: cap, debugId } = await getCaptureDetails(captureId);

    // 2) Try to find refund link
    const refundLink = (cap.links || []).find(l => l.rel === "refund")?.href;

    // If PayPal doesn't provide it in sandbox responses, return empty
    if (!refundLink) {
      return res.json({ ok: true, debugId, refunds: [] });
    }

    // 3) Call the refund link (PayPal gives full URL)
    const token = await (await import("./paypal.js")).getAccessToken(); // or reuse your function differently
    const r = await fetch(refundLink, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });

    const refundsData = await r.json().catch(() => ({}));
    const refundsDebugId = r.headers.get("paypal-debug-id");

    if (!r.ok) {
      // PayPal can return 404/400 when no refunds exist. Surface empty list instead of breaking the UI.
      if (r.status === 404 || r.status === 400 || r.status === 422) {
        return res.json({ ok: true, debugId: refundsDebugId || debugId, refunds: [] });
      }

      return res.status(r.status).json({
        error: "Failed to fetch refunds from PayPal",
        debugId: refundsDebugId,
        details: refundsData,
      });
    }

    // refundsData may be list-like depending on PayPal
    res.json({ ok: true, debugId: refundsDebugId || debugId, refunds: refundsData });
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message,
      debugId: e.debugId,
      details: e.data,
    });
  }
});

/**
 * ---------- OPTIONAL: Basic Auth for backoffice ----------
 * Put in .env:
 * ADMIN_USER=admin
 * ADMIN_PASS=admin123
 */
function basicAuthAdmin(req, res, next) {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;

  // If not configured, do not block
  if (!user || !pass) return next();

  const header = req.headers.authorization || "";
  const [type, creds] = header.split(" ");

  if (type !== "Basic" || !creds) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Backoffice"');
    return res.status(401).json({ error: "Missing Basic auth" });
  }

  const decoded = Buffer.from(creds, "base64").toString("utf-8");
  const [u, p] = decoded.split(":");

  if (u !== user || p !== pass) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Backoffice"');
    return res.status(401).json({ error: "Invalid credentials" });
  }

  next();
}

/**
 * Helper: validate money string (2 decimals max)
 */
function normalizeAmount(amount) {
  if (amount === undefined || amount === "") return null; // full refund (no amount provided)
  if (amount === null) return { error: "Amount cannot be null. Leave empty for full refund or provide a value > 0." };
  const s = String(amount).trim();

  // allow "5", "5.0", "5.00" but not "5.000" or "abc"
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    return { error: "Invalid amount format. Use e.g. 5.00" };
  }

  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) {
    return { error: "Amount must be > 0" };
  }

  return { value: n.toFixed(2) };
}

/**
 * 1) Create order
 */
app.post("/api/orders", async (req, res) => {
  try {
    const {
      currency = "USD",
      amount = "10.00",
      sku,
      name,
      buyerInfo,
    } = req.body || {};

    const { data, debugId } = await createOrder({ currency, amount, buyerInfo });

    res.status(201).json({
      orderID: data.id,
      status: data.status,
      debugId,
      meta: { sku, name },
      raw: data,
    });
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message,
      debugId: e.debugId,
      details: e.data,
    });
  }
});

/**
 * 2) Get order
 */
app.get("/api/orders/:orderID", async (req, res) => {
  try {
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
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message,
      debugId: e.debugId,
      details: e.data,
    });
  }
});

/**
 * 3) Patch order (shipping dynamique)
 */
app.patch("/api/orders/:orderID", async (req, res) => {
  try {
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
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message,
      debugId: e.debugId,
      details: e.data,
    });
  }
});

/**
 * 4) Capture order + store capture in transactions.json ✅
 */
app.post("/api/orders/:orderID/capture", async (req, res) => {
  try {
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
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message,
      debugId: e.debugId,
      details: e.data,
    });
  }
});

/**
 * ---------- PHASE 3 BACKOFFICE ----------
 */

/**
 * A) List stored transactions
 */
app.get("/api/admin/transactions", basicAuthAdmin, async (req, res) => {
  try {
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

    // Keep all events (captures, refunds, authorizations) to avoid missing items when PayPal changes event codes.
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
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message,
      debugId: e.debugId,
      details: e.data,
    });
  }
});

/**
 * B) Refund (full or partial)
 * body: { captureId: "...", amount?: "5.00" }
 */
app.post("/api/admin/refunds", basicAuthAdmin, async (req, res) => {
  try {
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
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message,
      debugId: e.debugId,
      details: e.data,
    });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
