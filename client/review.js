const SERVER_BASE =
  window.SERVER_BASE ||
  (window.location.hostname === "localhost" ? "http://localhost:3001" : window.location.origin);

const params = new URLSearchParams(window.location.search);
const orderID = params.get("orderID");
let itemTotal = null;
let currency = "USD";
const sku = params.get("sku") || "";
const name = params.get("name") || "";

const logEl = document.getElementById("log");
const confirmBtn = document.getElementById("confirmBtn");
const backBtn = document.getElementById("backBtn");

const orderIdEl = document.getElementById("orderIdEl");
const productEl = document.getElementById("productEl");
const shipToEl = document.getElementById("shipToEl");
const itemEl = document.getElementById("itemEl");
const shipEl = document.getElementById("shipEl");
const totalEl = document.getElementById("totalEl");

const log = (x) =>
  (logEl.textContent += (typeof x === "string" ? x : JSON.stringify(x, null, 2)) + "\n");
const money = (x) => `${currency} ${Number(x).toFixed(2)}`;

async function loadOrder() {
  const res = await fetch(`${SERVER_BASE}/api/orders/${orderID}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Get order failed");

  const address = data.address || {};
  const pu = data.order?.purchase_units?.[0] || {};
  if (pu.amount?.value) itemTotal = pu.amount.value;
  if (pu.amount?.currency_code) currency = pu.amount.currency_code;

  orderIdEl.textContent = orderID;
  productEl.textContent = name ? `${name}${sku ? ` (${sku})` : ""}` : sku || "-";
  shipToEl.textContent =
    `${address.address_line_1 || ""}${address.address_line_1 ? ", " : ""}${address.admin_area_2 || ""} ${
      address.admin_area_1 || ""
    } ${address.postal_code || ""} ${address.country_code || ""}`.trim() || "(not provided)";
  itemEl.textContent = money(itemTotal);
  shipEl.textContent = "Loading...";
  totalEl.textContent = "-";
}

async function patchShipping() {
  const res = await fetch(`${SERVER_BASE}/api/orders/${orderID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Patch failed");
  const shippingValue =
    data.shippingValue || data.raw?.purchase_units?.[0]?.amount?.breakdown?.shipping?.value || null;
  const currencyResp = data.currency || currency;
  if (data.itemTotal) itemTotal = data.itemTotal;
  if (currencyResp) currency = currencyResp;
  log({ patched: true, shippingValue, debugId: data.debugId });
  return shippingValue;
}

async function capture() {
  const res = await fetch(`${SERVER_BASE}/api/orders/${orderID}/capture`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Capture failed");
  log({ captured: true, status: data.status, debugId: data.debugId });
  alert("Payment captured! Status: " + data.status);
}

(async () => {
  if (!orderID) return alert("Missing orderID");
  backBtn.onclick = () => (window.location.href = "index.html");

  try {
    await loadOrder();
    const shippingValue = await patchShipping();
    if (shippingValue == null) throw new Error("Shipping value unavailable");
    shipEl.textContent = money(shippingValue);
    totalEl.textContent = money((Number(itemTotal) + Number(shippingValue)).toFixed(2));
    confirmBtn.disabled = false;
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Processing...";
      try {
        await capture();
        confirmBtn.textContent = "Done";
      } catch (e) {
        alert(e.message);
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Confirm & Pay";
      }
    };
  } catch (e) {
    alert(e.message);
  }
})();
