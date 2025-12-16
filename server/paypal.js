import { Buffer } from "node:buffer";

// Load .env ONLY when running locally.
// On Render, you must use Environment Variables in the dashboard.
async function loadDotenvIfLocal() {
  const isRender = !!process.env.RENDER;
  const isProd = process.env.NODE_ENV === "production";

  if (!isRender && !isProd) {
    try {
      const dotenv = await import("dotenv");
      dotenv.config();
    } catch {
      // dotenv is optional; ignore if not installed
    }
  }
}
await loadDotenvIfLocal();

// Support multiple env var names (helps if you named them differently in Render)
function firstDefined(...values) {
  for (const v of values) {
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return undefined;
}

const PAYPAL_CLIENT_ID = firstDefined(
  process.env.PAYPAL_CLIENT_ID,
  process.env.PAYPAL_CLIENTID,
  process.env.CLIENT_ID
);

const PAYPAL_SECRET = firstDefined(
  process.env.PAYPAL_SECRET,
  process.env.PAYPAL_CLIENT_SECRET,
  process.env.PAYPAL_CLIENTSECRET,
  process.env.CLIENT_SECRET
);

// Allow either PAYPAL_BASE_URL or PAYPAL_ENV=sandbox|live
const PAYPAL_ENV = firstDefined(process.env.PAYPAL_ENV, process.env.PAYPAL_MODE) || "sandbox";
const DEFAULT_BASE =
  PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

const PAYPAL_BASE_URL = firstDefined(process.env.PAYPAL_BASE_URL, process.env.PAYPAL_API_BASE) || DEFAULT_BASE;

// Helpful debug (does NOT print secrets)
const where = process.env.RENDER ? "Render" : "local";
console.log(`[PayPal] env source=${where} base=${PAYPAL_BASE_URL}`);
console.log(`[PayPal] clientId? ${!!PAYPAL_CLIENT_ID}  secret? ${!!PAYPAL_SECRET}`);

if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
  throw new Error(
    [
      "Missing PayPal credentials in environment variables.",
      "",
      "Expected (Render → Service → Environment):",
      "- PAYPAL_CLIENT_ID",
      "- PAYPAL_SECRET",
      "",
      "Optional:",
      "- PAYPAL_ENV = sandbox|live",
      "- PAYPAL_BASE_URL (overrides default)",
      "",
      "Tip: make sure you added them to the SAME Render service and redeployed.",
    ].join("\n")
  );
}

function basicAuth() {
  const creds = `${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`;
  return Buffer.from(creds).toString("base64");
}

export async function getAccessToken() {
  const url = `${PAYPAL_BASE_URL}/v1/oauth2/token`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const debugId = res.headers.get("paypal-debug-id");
    const err = new Error(`PayPal token error: ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.debugId = debugId;
    err.data = data;
    throw err;
  }

  return data.access_token;
}

async function paypalFetch(path, { method = "GET", token, body } = {}) {
  const url = `${PAYPAL_BASE_URL}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const debugId = res.headers.get("paypal-debug-id");
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(`PayPal API error: ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.debugId = debugId;
    err.data = data;
    throw err;
  }

  return { data, debugId };
}

// Normalize optional buyer info to the format expected by PayPal
function normalizeBuyerInfo(buyerInfo) {
  if (!buyerInfo || typeof buyerInfo !== "object") return null;

  const fullName = String(buyerInfo.fullName || "").trim();
  const email = String(buyerInfo.email || "").trim();

  const a = buyerInfo.address || {};
  const shippingAddress = {
    address_line_1: a.address_line_1 ? String(a.address_line_1).trim() : undefined,
    address_line_2: a.address_line_2 ? String(a.address_line_2).trim() : undefined,
    admin_area_2: a.admin_area_2 ? String(a.admin_area_2).trim() : undefined,
    admin_area_1: a.admin_area_1 ? String(a.admin_area_1).trim().toUpperCase() : undefined,
    postal_code: a.postal_code ? String(a.postal_code).trim() : undefined,
    country_code: a.country_code ? String(a.country_code).trim().toUpperCase() : undefined,
  };

  const hasMinAddress =
    shippingAddress.address_line_1 &&
    shippingAddress.admin_area_2 &&
    shippingAddress.admin_area_1 &&
    shippingAddress.postal_code &&
    shippingAddress.country_code;

  return {
    fullName: fullName || undefined,
    email: email || undefined,
    shippingAddress: hasMinAddress ? shippingAddress : null,
  };
}

export async function createOrder({ currency = "USD", amount = "10.00", buyerInfo } = {}) {
  const token = await getAccessToken();
  const norm = normalizeBuyerInfo(buyerInfo);

  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: "default",
        amount: {
          currency_code: currency,
          value: amount,
          breakdown: {
            item_total: { currency_code: currency, value: amount },
          },
        },
        items: [
          {
            name: "Demo Item",
            quantity: "1",
            unit_amount: { currency_code: currency, value: amount },
          },
        ],
      },
    ],
  };

  if (norm?.shippingAddress) {
    body.purchase_units[0].shipping = {
      name: norm.fullName ? { full_name: norm.fullName } : undefined,
      address: norm.shippingAddress,
    };
  }

  if (norm?.email) {
    body.payer = { email_address: norm.email };
  }

  return paypalFetch("/v2/checkout/orders", { method: "POST", token, body });
}

export async function getOrder(orderID) {
  const token = await getAccessToken();
  return paypalFetch(`/v2/checkout/orders/${orderID}`, { method: "GET", token });
}

export async function updateOrderShipping({ orderID, currency = "USD", itemTotal, shippingValue }) {
  const token = await getAccessToken();

  const total = (Number(itemTotal) + Number(shippingValue)).toFixed(2);

  const patchBody = [
    {
      op: "replace",
      path: "/purchase_units/@reference_id=='default'/amount",
      value: {
        currency_code: currency,
        value: total,
        breakdown: {
          item_total: { currency_code: currency, value: Number(itemTotal).toFixed(2) },
          shipping: { currency_code: currency, value: Number(shippingValue).toFixed(2) },
        },
      },
    },
  ];

  return paypalFetch(`/v2/checkout/orders/${orderID}`, {
    method: "PATCH",
    token,
    body: patchBody,
  });
}

export async function captureOrder(orderID) {
  const token = await getAccessToken();
  return paypalFetch(`/v2/checkout/orders/${orderID}/capture`, { method: "POST", token });
}

export async function refundCapture({ captureId, currency = "USD", amount } = {}) {
  const token = await getAccessToken();

  const body =
    amount != null
      ? { amount: { currency_code: currency, value: Number(amount).toFixed(2) } }
      : undefined;

  return paypalFetch(`/v2/payments/captures/${captureId}/refund`, {
    method: "POST",
    token,
    body,
  });
}

export async function getRefund(refundId) {
  const token = await getAccessToken();
  return paypalFetch(`/v2/payments/refunds/${refundId}`, { method: "GET", token });
}

export async function getCaptureDetails(captureId) {
  const token = await getAccessToken();
  return paypalFetch(`/v2/payments/captures/${captureId}`, { method: "GET", token });
}

export async function verifyWebhookSignature({
  authAlgo,
  certUrl,
  transmissionId,
  transmissionSig,
  transmissionTime,
  webhookId,
  body,
}) {
  const token = await getAccessToken();
  const payload = {
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: webhookId,
    webhook_event: body,
  };

  return paypalFetch("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    token,
    body: payload,
  });
}

function toReportingISO(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function listTransactions({ startDate, endDate, pageSize = 200 } = {}) {
  const token = await getAccessToken();
  const params = new URLSearchParams();

  const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate || new Date();

  params.set("start_date", toReportingISO(start));
  params.set("end_date", toReportingISO(end));
  const size = Math.max(1, Math.min(Number(pageSize) || 200, 500));
  params.set("page_size", String(size));

  return paypalFetch(`/v1/reporting/transactions?${params.toString()}`, {
    method: "GET",
    token,
  });
}
