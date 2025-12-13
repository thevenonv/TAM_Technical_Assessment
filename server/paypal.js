import "dotenv/config";

const {
  PAYPAL_CLIENT_ID,
  PAYPAL_SECRET,
  PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com",
} = process.env;

if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
  throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_SECRET in .env");
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

// --- helpers for Phase 2 buyer info -> PayPal shipping/payer ---
function normalizeBuyerInfo(buyerInfo) {
  if (!buyerInfo || typeof buyerInfo !== "object") return null;

  const fullName = String(buyerInfo.fullName || "").trim();
  const email = String(buyerInfo.email || "").trim();

  const a = buyerInfo.address || {};
  const shippingAddress = {
    address_line_1: a.address_line_1 ? String(a.address_line_1).trim() : undefined,
    address_line_2: a.address_line_2 ? String(a.address_line_2).trim() : undefined,
    admin_area_2: a.admin_area_2 ? String(a.admin_area_2).trim() : undefined, // city
    admin_area_1: a.admin_area_1 ? String(a.admin_area_1).trim().toUpperCase() : undefined, // state
    postal_code: a.postal_code ? String(a.postal_code).trim() : undefined,
    country_code: a.country_code ? String(a.country_code).trim().toUpperCase() : undefined,
  };

  // only keep if minimally valid
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

/**
 * Phase 1/2: Create order (intent CAPTURE)
 * amount: item total (shipping added later via PATCH)
 * buyerInfo: optional (Phase 2) -> sets purchase_units[0].shipping (+ optional payer email)
 */
export async function createOrder({ currency = "USD", amount = "10.00", buyerInfo } = {}) {
  const token = await getAccessToken();

  const norm = normalizeBuyerInfo(buyerInfo);

  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: "default", // ✅ ensures your PATCH path matches
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

  // ✅ inject shipping address from Phase 2 form (if provided)
  if (norm?.shippingAddress) {
    body.purchase_units[0].shipping = {
      name: norm.fullName ? { full_name: norm.fullName } : undefined,
      address: norm.shippingAddress,
    };
  }

  // ✅ optional: set payer email (PayPal may ignore/override in some flows)
  if (norm?.email) {
    body.payer = { email_address: norm.email };
  }

  return paypalFetch("/v2/checkout/orders", { method: "POST", token, body });
}

export async function getOrder(orderID) {
  const token = await getAccessToken();
  return paypalFetch(`/v2/checkout/orders/${orderID}`, { method: "GET", token });
}

/**
 * Update order to add shipping (PATCH)
 * shippingValue: ex "4.99"
 * IMPORTANT: total must match breakdown
 */
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

  // Full refund => body vide
  // Partial refund => body.amount requis
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

function toReportingISO(date) {
  const d = date instanceof Date ? date : new Date(date);
  // PayPal reporting wants YYYY-MM-DDTHH:mm:ssZ (no milliseconds)
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function listTransactions({ startDate, endDate, pageSize = 200 } = {}) {
  const token = await getAccessToken();
  const params = new URLSearchParams();

  const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate || new Date();

  params.set("start_date", toReportingISO(start));
  params.set("end_date", toReportingISO(end));
  const size = Math.max(1, Math.min(Number(pageSize) || 200, 500)); // PayPal max 500
  params.set("page_size", String(size));

  return paypalFetch(`/v1/reporting/transactions?${params.toString()}`, {
    method: "GET",
    token,
  });
}
