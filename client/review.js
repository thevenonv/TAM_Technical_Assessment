const SERVER_BASE =
  window.SERVER_BASE ||
  (window.location.hostname === "localhost"
    ? "https://tam-technical-assessment.onrender.com"
    : window.location.origin);

const params = new URLSearchParams(window.location.search);
const orderID = params.get("orderID");
const itemTotal = params.get("itemTotal");
const currency = params.get("currency") || "USD";
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

function computeShipping(postalCode, stateCode) {
  const zip = String(postalCode || "").trim();
  const zip5 = zip.match(/\d{5}/)?.[0];
  if (!zip5) return "7.99";
  const st = (stateCode || "").toUpperCase();
  if (["AK", "HI"].includes(st)) return "19.99";
  if (["PR", "VI", "GU", "AS", "MP"].includes(st)) return "24.99";
  const first = zip5[0];
  if (["0", "1", "2"].includes(first)) return "5.99";
  if (["3", "4"].includes(first)) return "7.49";
  if (["5", "6"].includes(first)) return "9.49";
  if (["7", "8", "9"].includes(first)) return "11.99";
  return "7.99";
}

async function loadOrder() {
  const res = await fetch(`${SERVER_BASE}/api/orders/${orderID}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Get order failed");

  const address = data.address || {};
  const shippingValue = computeShipping(address.postal_code, address.admin_area_1);
  const total = (Number(itemTotal) + Number(shippingValue)).toFixed(2);

  orderIdEl.textContent = orderID;
  productEl.textContent = name ? `${name}${sku ? ` (${sku})` : ""}` : sku || "-";
  shipToEl.textContent =
    `${address.address_line_1 || ""}${address.address_line_1 ? ", " : ""}${address.admin_area_2 || ""} ${
      address.admin_area_1 || ""
    } ${address.postal_code || ""} ${address.country_code || ""}`.trim() || "(not provided)";
  itemEl.textContent = money(itemTotal);
  shipEl.textContent = money(shippingValue);
  totalEl.textContent = money(total);

  confirmBtn.disabled = false;
  return { shippingValue };
}

async function patchShipping(shippingValue) {
  const res = await fetch(`${SERVER_BASE}/api/orders/${orderID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currency, itemTotal, shippingValue }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Patch failed");
  log({ patched: true, debugId: data.debugId });
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
    const { shippingValue } = await loadOrder();
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Processing...";
      try {
        await patchShipping(shippingValue);
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
