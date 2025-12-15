import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "local-transactions.json");

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    await fs.writeFile(STORE_PATH, "[]", "utf8");
  }
}

async function loadStore() {
  await ensureStore();
  const raw = await fs.readFile(STORE_PATH, "utf8").catch(() => "[]");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveStore(entries) {
  await ensureStore();
  await fs.writeFile(STORE_PATH, JSON.stringify(entries, null, 2), "utf8");
}

function findIndex(entries, { orderID, captureId }) {
  return entries.findIndex(
    (e) =>
      (orderID && e.orderID === orderID) ||
      (captureId && e.captureId && e.captureId === captureId),
  );
}

async function recordOrder({ orderID, amount, currency, product }) {
  if (!orderID) return;
  const entries = await loadStore();
  const idx = findIndex(entries, { orderID });
  const now = new Date().toISOString();
  const base = {
    orderID,
    amount: amount != null ? Number(amount) : null,
    currency: currency || "USD",
    product: product || {},
    createdAt: now,
    updatedAt: now,
  };
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], ...base, updatedAt: now };
  } else {
    entries.push(base);
  }
  await saveStore(entries);
}

async function recordCapture({ orderID, captureId, captureStatus, captureAmount, currency }) {
  if (!orderID && !captureId) return;
  const entries = await loadStore();
  const idx = findIndex(entries, { orderID, captureId });
  const now = new Date().toISOString();
  const update = {
    orderID: orderID || null,
    captureId: captureId || null,
    captureStatus: captureStatus || null,
    captureAmount: captureAmount != null ? Number(captureAmount) : null,
    currency: currency || entries[idx]?.currency || "USD",
    capturedAt: now,
    updatedAt: now,
  };

  if (idx >= 0) {
    entries[idx] = { ...entries[idx], ...update };
  } else {
    entries.push(update);
  }
  await saveStore(entries);
}

async function recordRefund({ captureId, refundId, amount, currency, status }) {
  if (!captureId) return;
  const entries = await loadStore();
  const idx = findIndex(entries, { captureId });
  const now = new Date().toISOString();
  const entry = idx >= 0 ? entries[idx] : null;

  // Fallbacks: if PayPal omits amount on full refund, reuse captureAmount/amount
  const resolvedAmount =
    amount != null
      ? Number(amount)
      : entry && entry.captureAmount != null
      ? Number(entry.captureAmount)
      : entry && entry.amount != null
      ? Number(entry.amount)
      : null;
  const resolvedCurrency = currency || entry?.currency || "USD";

  const refundItem = {
    refundId: refundId || null,
    amount: resolvedAmount,
    currency: resolvedCurrency,
    status: status || null,
    createdAt: now,
  };

  if (idx >= 0) {
    const refunds = Array.isArray(entries[idx].refunds) ? entries[idx].refunds : [];
    refunds.unshift(refundItem);
    entries[idx].refunds = refunds;
    entries[idx].updatedAt = now;
  } else {
    entries.push({
      captureId,
      refunds: [refundItem],
      createdAt: now,
      updatedAt: now,
    });
  }

  await saveStore(entries);
}

async function listEntries() {
  return loadStore();
}

export { recordOrder, recordCapture, recordRefund, listEntries };
