import fs from "fs/promises";
import path from "path";

export function getDataFilePath(__dirname) {
  return path.join(__dirname, "../data/transactions.json");
}

async function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

export async function readTransactions(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    // file missing / invalid JSON -> empty
    return [];
  }
}

export async function writeTransactions(filePath, txs) {
  const safe = Array.isArray(txs) ? txs : [];
  await ensureDirForFile(filePath);

  // ✅ atomic-ish write (write temp then rename)
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(safe, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}

export async function addTransaction(filePath, tx) {
  const txs = await readTransactions(filePath);

  const minimal = {
    orderID: tx.orderID,
    captureId: tx.captureId,
  };

  // prevent duplicates
  if (minimal.captureId && txs.some(t => t.captureId === minimal.captureId)) {
    return minimal;
  }

  txs.unshift(minimal);
  await writeTransactions(filePath, txs);
  return minimal;
}

export async function updateTransaction(filePath, captureId, patch) {
  const txs = await readTransactions(filePath);
  const idx = txs.findIndex((t) => t.captureId === captureId);
  if (idx === -1) return null;

  txs[idx] = {
    ...txs[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  await writeTransactions(filePath, txs);
  return txs[idx];
}