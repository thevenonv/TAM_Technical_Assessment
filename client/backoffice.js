const SERVER_BASE =
  window.SERVER_BASE ||
  (window.location.hostname === "localhost"
    ? "https://tam-technical-assessment.onrender.com"
    : window.location.origin);

const tbody = document.getElementById("tbody");
const refreshBtn = document.getElementById("refreshBtn");
const filterSellBtn = document.getElementById("filterSell");
const filterRefundsBtn = document.getElementById("filterRefunds");
const pageSizeSelect = document.getElementById("pageSize");
const thOrder = document.getElementById("th-order");
const thCapture = document.getElementById("th-capture");

let flowFilter = "sell"; // "sell" => positive tx, "refund" => negative tx
let maxRows = Number(pageSizeSelect?.value) || 5;

function pill(status) {
  const s = (status || "").toUpperCase();
  let cls = "pill";
  if (["COMPLETED", "CAPTURED", "REFUNDED"].includes(s)) cls += " ok";
  else if (s === "PENDING" || s === "PARTIALLY_REFUNDED") cls += " warn";
  else cls += " danger";
  return `<span class="${cls}">${s || "?"}</span>`;
}

function fmtMoney(amount, currency = "USD") {
  if (amount == null || isNaN(Number(amount))) return "?";
  return `${currency} ${Number(amount).toFixed(2)}`;
}

function fmtTime(iso) {
  if (!iso) return "?";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function refundCapture(captureId, amount) {
  const payload = { captureId };
  if (amount && String(amount).trim() !== "") {
    payload.amount = String(amount).trim();
  }

  const res = await fetch(`${SERVER_BASE}/api/admin/refunds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Refund failed");
  }
  return data;
}

async function fetchRefundSummary(captureId, fallback = null) {
  // fallback contains refundedSum/currency/time derived from reporting negatives
  const base = {
    total: fallback?.refundedSum || 0,
    currency: fallback?.currency || "USD",
    status: "UNKNOWN",
    items: [],
  };

  if (!captureId) return base;

  let captureStatus = "UNKNOWN";
  let captureAmount = null;
  let captureCurrency = base.currency;

  // Fetch capture details first (status + amount)
  try {
    const resCap = await fetch(`${SERVER_BASE}/api/admin/captures/${encodeURIComponent(captureId)}`);
    const dataCap = await resCap.json();
    if (resCap.ok && dataCap.capture) {
      captureStatus = (dataCap.capture.status || "UNKNOWN").toUpperCase();
      captureAmount = Number.isFinite(Number(dataCap.capture.amount))
        ? Math.abs(Number(dataCap.capture.amount))
        : null;
      captureCurrency = dataCap.capture.currency || captureCurrency;
    }
  } catch {
    // ignore, will rely on refunds endpoint / fallback
  }

  // Then try refunds list
  let items = [];
  let totalFromRefunds = 0;
  try {
    const res = await fetch(
      `${SERVER_BASE}/api/admin/captures/${encodeURIComponent(captureId)}/refunds`,
    );
    const data = await res.json();
    if (res.ok) {
      const refunds = data.refunds?.refunds || data.refunds?.items || data.refunds || [];
      const cur = data.captureCurrency || captureCurrency;
      items = refunds.map((r) => ({
        status: (r.status || "").toUpperCase(),
        amount: Math.abs(Number(r.amount?.value || 0)),
        currency: r.amount?.currency_code || cur,
        time: r.create_time || r.update_time || null,
      }));
      totalFromRefunds = refunds.reduce(
        (sum, r) => sum + Math.abs(Number(r.amount?.value || 0)),
        0,
      );
      captureStatus = (data.captureStatus || captureStatus || "UNKNOWN").toUpperCase();
      if (!captureAmount && Number.isFinite(Number(data.captureAmount))) {
        captureAmount = Math.abs(Number(data.captureAmount));
      }
      if (!captureCurrency && data.captureCurrency) captureCurrency = data.captureCurrency;
    }
  } catch {
    // ignore; will rely on fallback
  }

  // If PayPal says REFUNDED but no list, fill full amount.
  if (!items.length && captureStatus === "REFUNDED" && captureAmount != null) {
    items.push({
      status: "REFUNDED (PayPal)",
      amount: captureAmount,
      currency: captureCurrency,
      time: null,
    });
    totalFromRefunds = captureAmount;
  }

  // If still nothing, but we have reporting fallback, use it (works for partials)
  if (!items.length && fallback?.refundedSum) {
    const val = Math.abs(Number(fallback.refundedSum));
    items.push({
      status: captureStatus === "PARTIALLY_REFUNDED" ? "PARTIAL (reported)" : "REPORTED",
      amount: val,
      currency: fallback.currency || captureCurrency,
      time: fallback.time || null,
    });
    totalFromRefunds = val;
  }

  const total = Math.max(totalFromRefunds, Math.abs(Number(fallback?.refundedSum || 0)));

  return {
    total,
    currency: items[0]?.currency || captureCurrency || base.currency,
    status: captureStatus || base.status,
    items,
  };
}

async function fetchWebhookRefund(captureId) {
  if (!captureId) return null;
  try {
    const res = await fetch(
      `${SERVER_BASE}/api/admin/webhooks/refunds/${encodeURIComponent(captureId)}`
    );
    const data = await res.json();
    if (!res.ok || !data?.data) return null;
    return data.data;
  } catch {
    return null;
  }
}

async function fetchWebhookCapture(captureId) {
  if (!captureId) return null;
  try {
    const res = await fetch(
      `${SERVER_BASE}/api/admin/webhooks/captures/${encodeURIComponent(captureId)}`
    );
    const data = await res.json();
    if (!res.ok || !data?.data) return null;
    return data.data;
  } catch {
    return null;
  }
}

async function loadTransactions() {
  tbody.innerHTML = `<tr><td colspan="6">Loading...</td></tr>`;

  let data;
  let webhookCaptures = [];
  let webhookRefunds = [];
  try {
    const [resTx, resWebhookCaps, resWebhookRefunds] = await Promise.all([
      fetch(`${SERVER_BASE}/api/admin/transactions?pageSize=500`),
      fetch(`${SERVER_BASE}/api/admin/webhooks/captures`).catch(() => null),
      fetch(`${SERVER_BASE}/api/admin/webhooks/refunds`).catch(() => null),
    ]);
    data = await resTx.json();
    if (!resTx.ok) throw new Error(data.error || "Failed to load transactions");
    if (resWebhookCaps && resWebhookCaps.ok) {
      const w = await resWebhookCaps.json();
      webhookCaptures = Array.isArray(w.data) ? w.data : [];
    }
    if (resWebhookRefunds && resWebhookRefunds.ok) {
      const w = await resWebhookRefunds.json();
      webhookRefunds = Array.isArray(w.data) ? w.data : [];
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:#fca5a5;">${err.message}</td></tr>`;
    return;
  }

  const txs = data.transactions || [];
  const webhookRefundMap = webhookRefunds.reduce((acc, r) => {
    if (r.captureId) acc[r.captureId] = r;
    return acc;
  }, {});

  // Merge in captures seen via webhook but not yet in reporting
  webhookCaptures.forEach((cap) => {
    const already = txs.some((t) => t.captureId === cap.captureId);
    if (!already && cap.captureId) {
      txs.push({
        _fromWebhook: true,
        orderID: cap.orderID || null,
        captureId: cap.captureId,
        status: cap.status || "COMPLETED",
        amount: cap.amount != null ? String(cap.amount) : null,
        currency: cap.currency || "USD",
        createTime: cap.createdAt || cap.updatedAt || null,
      });
    }
  });
  // Merge in refunds seen via webhook (as negative amounts)
  webhookRefunds.forEach((ref) => {
    const already = txs.some(
      (t) => t.captureId === ref.captureId && Number(t.amount) < 0,
    );
    if (!already && ref.captureId && ref.total != null) {
      txs.push({
        _fromWebhook: true,
        orderID: ref.orderID || null,
        captureId: ref.captureId,
        status: ref.status || "REFUNDED",
        amount: String(-Math.abs(Number(ref.total))),
        currency: ref.currency || "USD",
        createTime: ref.updatedAt || ref.createdAt || null,
      });
    }
  });

  // Build map of refunds from reporting (negative amounts)
  const refundMap = {};
  txs
    .filter((tx) => Number.isFinite(Number(tx.amount)) && Number(tx.amount) < 0)
    .forEach((tx) => {
      // For refund transactions, paypal_reference_id (normalized as orderID) points to the original capture.
      const key = tx.orderID || tx.captureId;
      if (!key) return;
      if (!refundMap[key]) refundMap[key] = [];
      refundMap[key].push({
        amount: Math.abs(Number(tx.amount)),
        currency: tx.currency || "USD",
        status: (tx.status || "").toUpperCase(),
        time: tx.createTime || null,
      });
    });

  const filtered = txs
    .filter((tx) => {
      const n = Number(tx.amount);
      if (!Number.isFinite(n) && !tx._fromWebhook) return false;
      if (Number.isFinite(n)) {
        if (flowFilter === "sell") return n > 0;
        if (flowFilter === "refund") return n < 0;
      }
      // Allow webhook-only captures (amount might be missing)
      if (tx._fromWebhook) return flowFilter !== "refund";
      return true;
    })
    .sort((a, b) => {
      const ta = a.createTime ? Date.parse(a.createTime) : 0;
      const tb = b.createTime ? Date.parse(b.createTime) : 0;
      return tb - ta;
    });

  const limit = Number.isFinite(maxRows) && maxRows > 0 ? maxRows : 5;
  const limited = limit ? filtered.slice(0, limit) : filtered;

  if (!limited.length) {
    tbody.innerHTML = `<tr><td colspan="6">No transactions for this filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";

  limited.forEach((tx, idx) => {
    const tr = document.createElement("tr");
    const captureId = tx.captureId || "";
    const rowId = `row-${idx}-${captureId || tx.orderID || "tx"}`;

    const txAmount = Math.abs(Number(tx.amount) || 0);
    const reportedRefunds = refundMap[captureId] || refundMap[tx.orderID] || [];
    const refundedSum = reportedRefunds.reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    const webhookSnap = webhookRefundMap[captureId];
    const webhookTotal = webhookSnap?.total != null ? Math.abs(Number(webhookSnap.total)) : null;
    const remaining = Math.max(0, txAmount - (webhookTotal != null ? webhookTotal : refundedSum));

    tr.dataset.captureId = captureId;
    tr.dataset.remaining = String(remaining);
    tr.dataset.amount = String(txAmount);

    tr.innerHTML = `
      <td><code>${tx.orderID || "-"}</code></td>
      <td><code id="${rowId}-capture">${captureId || "-"}</code></td>
      <td id="${rowId}-date">${fmtTime(tx.createTime)}</td>
      <td>${fmtMoney(tx.amount, tx.currency)}</td>
      <td id="${rowId}-refund">${
        Number(tx.amount) > 0
          ? webhookTotal != null || refundedSum > 0
            ? `${pill(webhookSnap?.status || (refundedSum > 0 ? "PARTIALLY_REFUNDED" : "NOT_REFUNDED"))}
               <span class="pill">Refunded ${fmtMoney(
                 webhookTotal != null ? webhookTotal : refundedSum,
                 webhookSnap?.currency || tx.currency
               )}</span>`
            : "Loading..."
          : "-"
      }</td>
      <td>
        ${
          Number(tx.amount) > 0
            ? `
          <input class="amt" placeholder="(full)" data-row="${rowId}" />
          <div class="action-buttons">
            <button class="ghost" data-action="refund" data-row="${rowId}" data-capture="${captureId}">Partial refund</button>
            <button data-action="full-refund" data-row="${rowId}" data-capture="${captureId}">Full refund</button>
          </div>
        `
            : "-"
        }
      </td>
    `;

    tbody.appendChild(tr);

    // If this is a refund row or missing captureId, skip further processing
    if (!captureId || Number(tx.amount) <= 0) return;

    // Prefer real-time capture info from webhook if present
    fetchWebhookCapture(captureId)
      .then((cap) => {
        if (!cap) return;
        const dateCell = document.getElementById(`${rowId}-date`);
        if (dateCell && cap.createdAt) dateCell.textContent = fmtTime(cap.createdAt);
        const capCell = document.getElementById(`${rowId}-capture`);
        if (capCell && cap.captureId) capCell.innerHTML = `<code>${cap.captureId}</code>`;
      })
      .catch(() => {});

    const fallback = {
      refundedSum,
      currency: reportedRefunds[0]?.currency || tx.currency || "USD",
      time: reportedRefunds[0]?.time || null,
    };

    fetchRefundSummary(captureId, fallback)
      .then((summary) => {
        const refundCell = document.getElementById(`${rowId}-refund`);
        if (!refundCell) return;

        const updateCell = (usedTotalVal, statusVal, currencyVal) => {
          const remainingAfter = Math.max(0, txAmount - usedTotalVal);
          tr.dataset.remaining = String(remainingAfter);
          const finalStatus =
            usedTotalVal < 1e-2 && statusVal === "COMPLETED" ? "NOT_REFUNDED" : statusVal;

          refundCell.innerHTML = `
            ${pill(finalStatus)}
            <span class="pill">Refunded ${fmtMoney(usedTotalVal, currencyVal)}</span>
          `;

          if (remainingAfter <= 0) {
            const input = tr.querySelector(`input[data-row="${rowId}"]`);
            const buttons = tr.querySelectorAll(`button[data-row="${rowId}"]`);
            if (input) input.disabled = true;
            buttons.forEach((b) => (b.disabled = true));
          }
        };

        // Prefer webhook snapshot if present, otherwise summary/refunds
        let usedTotal =
          webhookTotal != null
            ? Math.max(webhookTotal, refundedSum, summary.total || 0)
            : Math.max(refundedSum, summary.total || 0);
        let statusLabel =
          webhookSnap?.status ||
          summary.status ||
          (usedTotal >= txAmount - 1e-2 ? "REFUNDED" : "PARTIALLY_REFUNDED");
        let currencyLabel = webhookSnap?.currency || summary.currency || tx.currency;

        // If still zero and no webhook total, try pulling latest webhook snapshot directly
        if (usedTotal <= 1e-2 && webhookTotal == null) {
          fetchWebhookRefund(captureId)
            .then((snap) => {
              if (snap && snap.total != null) {
                const snapTotal = Math.abs(Number(snap.total));
                const snapStatus = snap.status || statusLabel;
                const snapCur = snap.currency || currencyLabel;
                updateCell(Math.max(snapTotal, usedTotal), snapStatus, snapCur);
              } else {
                updateCell(usedTotal, statusLabel, currencyLabel);
              }
            })
            .catch(() => updateCell(usedTotal, statusLabel, currencyLabel));
        } else {
          updateCell(usedTotal, statusLabel, currencyLabel);
        }
      })
      .catch((err) => {
        const refundCell = document.getElementById(`${rowId}-refund`);
        if (refundCell) refundCell.innerHTML = `<span class="pill danger">${err.message}</span>`;
      });
  });
}

tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const { action, row: rowId, capture } = btn.dataset;
  if (!action || !capture) return;

  const tr = document.querySelector(`tr[data-capture-id="${capture}"]`) || btn.closest("tr");
  const input = document.querySelector(`input[data-row="${rowId}"]`);
  const remaining = tr ? Number(tr.dataset.remaining) : NaN;
  const captureAmount = tr ? Number(tr.dataset.amount) : NaN;

  let amount = "";
  if (action === "refund") {
    amount = input?.value?.trim() || "";
    const num = Number(amount);
    if (!amount || !Number.isFinite(num) || num <= 0) {
      alert("Enter an amount > 0 for partial refund.");
      return;
    }
    if (Number.isFinite(remaining) && num > remaining + 1e-9) {
      alert(`Amount exceeds remaining refundable balance (${remaining.toFixed(2)}).`);
      return;
    }
  } else if (action === "full-refund") {
    if (Number.isFinite(remaining)) {
      amount = remaining.toFixed(2);
    } else if (Number.isFinite(captureAmount)) {
      amount = captureAmount.toFixed(2);
    } else {
      amount = "";
    }
  }

  btn.disabled = true;
  try {
    await refundCapture(capture, amount);
    await loadTransactions();
    alert("Refund done!");
  } catch (err) {
    console.error(err);
    alert(err.message || "Refund failed");
  } finally {
    btn.disabled = false;
  }
});

function setFlowFilter(next) {
  flowFilter = next;
  if (filterSellBtn && filterRefundsBtn) {
    filterSellBtn.classList.toggle("active", next === "sell");
    filterRefundsBtn.classList.toggle("active", next === "refund");
  }
  if (thOrder && thCapture) {
    if (flowFilter === "refund") {
      thOrder.textContent = "Capture ID";
      thCapture.textContent = "Refund ID";
    } else {
      thOrder.textContent = "Order";
      thCapture.textContent = "Capture ID";
    }
  }
  loadTransactions();
}

if (refreshBtn) refreshBtn.addEventListener("click", () => loadTransactions());
if (filterSellBtn) filterSellBtn.addEventListener("click", () => setFlowFilter("sell"));
if (filterRefundsBtn) filterRefundsBtn.addEventListener("click", () => setFlowFilter("refund"));
if (pageSizeSelect) {
  pageSizeSelect.addEventListener("change", () => {
    const val = Number(pageSizeSelect.value);
    maxRows = Number.isFinite(val) && val > 0 ? val : 5;
    loadTransactions();
  });
}

loadTransactions();
