const SERVER_BASE = "http://localhost:3001";

const tbody = document.getElementById("tbody");
const logEl = document.getElementById("log");
const refreshBtn = document.getElementById("refreshBtn");
const filterSellBtn = document.getElementById("filterSell");
const filterRefundsBtn = document.getElementById("filterRefunds");

let flowFilter = "sell"; // "sell" -> positive amounts, "refund" -> negative amounts

function log(x) {
  logEl.textContent =
    (typeof x === "string" ? x : JSON.stringify(x, null, 2)) + "\n\n" + logEl.textContent;
}

function pill(status) {
  const s = (status || "").toUpperCase();
  let cls = "pill";
  if (["COMPLETED", "CAPTURED"].includes(s)) cls += " ok";
  else if (["PENDING"].includes(s)) cls += " warn";
  else cls += " danger";
  return `<span class="${cls}">${s || "?"}</span>`;
}

function money(tx) {
  const a = tx?.amount;
  const c = tx?.currency || "USD";
  if (a == null) return "?";
  return `${c} ${Number(a).toFixed(2)}`;
}

function fmtTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// Fetch PayPal refund details (hydration) by refund ID
async function fetchRefund(refundId) {
  const res = await fetch(`${SERVER_BASE}/api/admin/refunds/${encodeURIComponent(refundId)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Refund fetch failed");
  return data.refund;
}

async function renderRefundHistory(cellEl, refundIds, captureAmount) {
  if (!refundIds || refundIds.length === 0) {
    cellEl.textContent = "?";
    return;
  }

  cellEl.innerHTML = `<span class="pill warn">Loading…</span>`;

  try {
    const refunds = await Promise.all(
      refundIds.map(async (rid) => {
        const r = await fetchRefund(rid);
        return {
          id: r.id,
          status: r.status,
          amount: r.amount?.value ?? null,
          currency: r.amount?.currency_code ?? "USD",
          create_time: r.create_time,
        };
      })
    );

    cellEl.innerHTML = refunds
      .map((r) => {
        const isFull = r.amount == null;
        const base = isFull && Number.isFinite(Number(captureAmount))
          ? Math.abs(Number(captureAmount))
          : Number(r.amount ?? NaN);
        const amtStr = Number.isFinite(base) ? Math.abs(base).toFixed(2) : "?";
        const cur = r.currency || "USD";
        return `
          <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:6px;">
            ${r.status ? pill(r.status) : ""}
            <span class="pill">${cur} ${amtStr}</span>
            ${r.id ? `<span class="pill"><code>${r.id}</code></span>` : ""}
            ${r.create_time ? `<span class="pill">${fmtTime(r.create_time)}</span>` : ""}
          </div>
        `;
      })
      .join("");
  } catch (err) {
    cellEl.innerHTML = `<span class="pill danger">${err.message}</span>`;
  }
}

async function renderRefundHistoryFromCapture(cellEl, captureId, captureAmount) {
  if (!captureId) {
    cellEl.textContent = "No refunds";
    return;
  }

  cellEl.innerHTML = `<span class="pill warn">Loading…</span>`;

  try {
    const res = await fetch(
      `${SERVER_BASE}/api/admin/captures/${encodeURIComponent(captureId)}/refunds`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to fetch refunds");

    // Depending on PayPal response shape, normalize:
    const refunds = data.refunds?.refunds || data.refunds?.items || data.refunds || [];
    const status = (data.captureStatus || "").toUpperCase();
    const captureAmt =
      Number.isFinite(Number(data.captureAmount))
        ? Math.abs(Number(data.captureAmount))
        : Number.isFinite(Number(captureAmount))
        ? Math.abs(Number(captureAmount))
        : null;
    const captureCur = data.captureCurrency || "USD";

    // If PayPal marks the capture as fully refunded, disable actions for this row
    if (status === "REFUNDED") {
      const row = document.querySelector(`tr[data-capture="${captureId}"]`);
      if (row) {
        row.dataset.remaining = "0";
        const input = row.querySelector(`input[data-capture="${captureId}"]`);
        const buttons = row.querySelectorAll(`button[data-capture="${captureId}"]`);
        if (input) input.disabled = true;
        buttons.forEach((b) => (b.disabled = true));
      }
    }

    if (!refunds.length) {
      if (status === "REFUNDED") {
        const amtStr = Number.isFinite(captureAmt) ? captureAmt.toFixed(2) : "?";
        cellEl.innerHTML = `<span class="pill warn">Fully refunded (PayPal)</span> <span class="pill">${captureCur} ${amtStr}</span>`;
      } else {
        cellEl.textContent = "No refunds";
      }
      return;
    }

    let rendered = refunds
      .map((r) => {
        const isFull = !r.amount || r.amount.value == null;
        const base = isFull && Number.isFinite(Number(captureAmount))
          ? Math.abs(Number(captureAmount))
          : Number(r.amount?.value ?? NaN);
        const amtStr = Number.isFinite(base) ? Math.abs(base).toFixed(2) : "?";
        const cur = r.amount?.currency_code || "USD";
        const t = r.create_time ? fmtTime(r.create_time) : "";
        return {
          display: `
          <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:6px;">
            <span class="pill">${cur} ${amtStr}</span>
            ${t ? `<span class="pill">${t}</span>` : ""}
          </div>
        `,
          amount: Number.isFinite(base) ? Math.abs(base) : 0,
        };
      });

    const totalRefunded = rendered.reduce((s, r) => s + (r.amount || 0), 0);
    cellEl.innerHTML = rendered.map((r) => r.display).join("");

    // If total refunded equals or exceeds capture amount, treat as fully refunded (disable actions)
    if (Number.isFinite(captureAmt) && totalRefunded >= captureAmt - 1e-2) {
      const row = document.querySelector(`tr[data-capture="${captureId}"]`);
      if (row) {
        row.dataset.remaining = "0";
        const input = row.querySelector(`input[data-capture="${captureId}"]`);
        const buttons = row.querySelectorAll(`button[data-capture="${captureId}"]`);
        if (input) input.disabled = true;
        buttons.forEach((b) => (b.disabled = true));

        cellEl.innerHTML += `<div style="margin-top:6px;"><span class="pill warn">Fully refunded (calculated)</span> <span class="pill">${captureCur} ${captureAmt.toFixed(2)}</span></div>`;
      }
    }
  } catch (err) {
    // If PayPal says 404/NO REFUNDS, keep existing display (likely lag) instead of wiping it
    if (err.message && err.message.includes("404")) {
      // Explicitly show "No refunds yet" so we don't leave the spinner
      cellEl.textContent = "No refunds yet";
      return;
    }
    cellEl.innerHTML = `<span class="pill danger">${err.message}</span>`;
  }
}

function renderRefundHistoryInline(cellEl, refunds, captureAmount) {
  if (!refunds || !refunds.length) {
    cellEl.textContent = "No refunds yet";
    return;
  }

  cellEl.innerHTML = refunds
    .map((r) => {
      const isFull = !r.amount || r.amount.value == null;
      const base = isFull && Number.isFinite(captureAmount)
        ? Math.abs(Number(captureAmount))
        : Number(r.amount?.value ?? NaN);
      const amtStr = Number.isFinite(base) ? Math.abs(base).toFixed(2) : "?";
      const cur = r.amount?.currency_code || "USD";
      const t = r.create_time ? fmtTime(r.create_time) : "";
      return `
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:6px;">
          <span class="pill">${cur} ${amtStr}</span>
          ${t ? `<span class="pill">${t}</span>` : ""}
        </div>
      `;
    })
    .join("");
}

// Fetch a specific capture by ID to surface it immediately (before reporting API latency)
async function fetchSingleCapture(captureId) {
  if (!captureId) return null;
  const res = await fetch(`${SERVER_BASE}/api/admin/captures/${encodeURIComponent(captureId)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch capture");
  const c = data.capture;
  if (!c) return null;
  return {
    orderID: c.orderID || null,
    captureId: c.captureId || captureId,
    status: c.status || null,
    amount: c.amount || null,
    currency: c.currency || "USD",
    createTime: c.createTime || null,
    payerEmail: c.payerEmail || null,
    eventCode: "CAPTURE",
    debugId: data.debugId,
    raw: c.raw,
  };
}

function getRecentCaptureIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get("captureId") || params.get("recentCapture") || null;
}

async function loadTransactions() {
  console.log("Loading transactions from", `${SERVER_BASE}/api/admin/transactions?pageSize=1000`);
  tbody.innerHTML = `<tr><td colspan="7">Loading…</td></tr>`;
  let data;
  try {
    const res = await fetch(`${SERVER_BASE}/api/admin/transactions?pageSize=1000`);
    data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load transactions");
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="7" style="color:#fca5a5;">${err.message || "Failed to load transactions"}</td></tr>`;
    alert(err.message || "Failed to load transactions");
    return;
  }

  const txs = data.transactions || [];
  const extraCaptureId = getRecentCaptureIdFromQuery();
  let extraCapture = null;
  if (extraCaptureId) {
    try {
      extraCapture = await fetchSingleCapture(extraCaptureId);
    } catch (e) {
      console.warn("Failed to fetch live capture", e);
    }
  }

  // Build map of refunds (negative amounts) keyed by orderID (equals captureId of sale)
  const refundMap = {};
  txs
    .filter((tx) => Number.isFinite(Number(tx.amount)) && Number(tx.amount) < 0)
    .forEach((tx) => {
      const key = tx.orderID || tx.captureId;
      if (!key) return;
      if (!refundMap[key]) refundMap[key] = [];
      refundMap[key].push({
        id: tx.captureId || tx.orderID,
        status: tx.status,
        amount: { value: tx.amount, currency_code: tx.currency },
        create_time: tx.createTime,
      });
    });

  const txsWithExtras = [...txs];
  if (extraCapture) {
    const already = txsWithExtras.some(
      (t) =>
        (t.captureId && t.captureId === extraCapture.captureId) ||
        (extraCapture.orderID && t.orderID === extraCapture.orderID)
    );
    if (!already) {
      txsWithExtras.unshift(extraCapture);
    }
  }

  const filtered = txsWithExtras.filter((tx) => {
    const n = Number(tx.amount);
    if (!Number.isFinite(n)) return true;
    if (flowFilter === "sell") return n > 0;
    if (flowFilter === "refund") return n < 0;
    return true;
  }).sort((a, b) => {
    const ta = a.createTime ? Date.parse(a.createTime) : 0;
    const tb = b.createTime ? Date.parse(b.createTime) : 0;
    return tb - ta; // newest first
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7">No transactions for this filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";

  filtered.forEach((tx, idx) => {
    const tr = document.createElement("tr");

    const captureId = tx.captureId ? String(tx.captureId) : "";
    const captureKey =
      captureId ||
      (tx.orderID ? String(tx.orderID) : "") ||
      `row-${idx}-${Math.random().toString(16).slice(2)}`;
    const refundCellId = `rh-${captureKey.replace(/[^a-zA-Z0-9_-]/g, "")}`;

    const amtNum = Number(tx.amount);
    const isRefundFlow = Number.isFinite(amtNum) && amtNum < 0;
    const historyId = isRefundFlow ? (tx.orderID || captureId) : captureKey;
    const refundsForCapture = refundMap[captureId] || refundMap[tx.orderID] || [];
    const refundedSum = (refundsForCapture || []).reduce(
      (s, r) => s + Math.abs(Number(r.amount?.value || 0)),
      0
    );
    const isFullyRefunded =
      !isRefundFlow && Number.isFinite(amtNum) && refundedSum >= Math.abs(amtNum);
    const remainingRefundable =
      !isRefundFlow && Number.isFinite(amtNum)
        ? Math.max(0, Math.abs(amtNum) - refundedSum)
        : 0;

    tr.dataset.remaining = remainingRefundable;
    tr.dataset.currency = tx.currency || "USD";
    tr.dataset.capture = captureKey;
    tr.dataset.captureAmount = amtNum;

    tr.innerHTML = `
      <td><code>${tx.orderID || "?"}</code></td>
      <td><code>${captureId || "?"}</code></td>
      <td>${fmtTime(tx.createTime) || "?"}</td>
      <td>${tx.error ? "?" : money(tx)}</td>
      <td>
        <input class="amt" placeholder="(full)" data-capture="${captureKey}" ${
          isRefundFlow || isFullyRefunded ? "disabled" : ""
        } />
      </td>
      <td>
        <button class="ghost" data-action="refund" data-capture="${captureKey}" ${
          isRefundFlow || isFullyRefunded ? "disabled" : ""
        }>Partial refund</button>
        <button data-action="full-refund" data-capture="${captureKey}" ${
          isRefundFlow || isFullyRefunded ? "disabled" : ""
        }>Full refund</button>
      </td>
      <td id="${refundCellId}" class="col-refund-history">
        ${tx.error ? `<span class="pill danger">${tx.error}</span>` : `<span class="pill">No refunds yet</span>`}
      </td>
    `;

    tbody.appendChild(tr);

    if (!tx.error) {
      const cellEl = document.getElementById(refundCellId);
      if (isRefundFlow) {
        cellEl.textContent = "-";
      } else if (refundsForCapture && refundsForCapture.length) {
        renderRefundHistoryInline(cellEl, refundsForCapture, amtNum);
      } else if (!historyId) {
        cellEl.innerHTML = `<span class="pill">No refunds yet</span>`;
      } else {
        renderRefundHistoryFromCapture(cellEl, historyId, amtNum);
      }
    }

    // disable actions if amount field is empty
    const amtInput = tr.querySelector(`input[data-capture="${captureKey}"]`);
    const buttons = tr.querySelectorAll(`button[data-capture="${captureKey}"]`);
    const toggleButtons = () => {
      // Keep buttons enabled visually; validation happens on click
    };
    if (amtInput) {
      amtInput.addEventListener("input", toggleButtons);
      toggleButtons();
    }
  });
}

async function refundCapture(captureId, amount) {
  if (!captureId) {
    alert("Missing captureId");
    return;
  }

  const payload = { captureId };
  if (amount && amount.trim() !== "") {
    const trimmed = amount.trim();
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num <= 0) {
      alert("Amount must be greater than 0 for partial refund.");
      return;
    }
    payload.amount = trimmed;
  } else if (amount === null) {
    alert("Amount cannot be null.");
    return;
  }

  const res = await fetch(`${SERVER_BASE}/api/admin/refunds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    // Friendly messages for common PayPal errors
    const issue =
      data?.details?.details?.find?.((d) => d.issue) ||
      (Array.isArray(data?.details) ? data.details.find((d) => d.issue) : null);
    if (issue?.issue === "CAPTURE_FULLY_REFUNDED") {
      throw new Error("This capture is already fully refunded (PayPal).");
    }
    throw new Error(data.error || issue?.description || "Refund failed");
  }

  log({
    ok: true,
    refundId: data.refundId,
    status: data.refund?.status,
    amount: data.refund?.amount,
    debugId: data.debugId,
  });

  return data;
}

tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  if (btn.dataset.action === "refund" || btn.dataset.action === "full-refund") {
    const captureId = btn.dataset.capture;
    const input = document.querySelector(`input[data-capture="${captureId}"]`);
    const amount = btn.dataset.action === "full-refund" ? "" : input ? input.value : null;
    const row = btn.closest("tr");
    const remaining = row ? Number(row.dataset.remaining) : null;

    btn.disabled = true;
    try {
      if (btn.dataset.action === "refund") {
        if (!amount || amount.trim() === "") {
          alert("Enter an amount greater than 0 for a partial refund.");
          return;
        }
        const num = Number(amount.trim());
        if (!Number.isFinite(num) || num <= 0) {
          alert("Enter an amount greater than 0 for a partial refund.");
          return;
        }
        // Prevent over-refund client-side: compare against transaction amount
        if (remaining != null && Number.isFinite(remaining) && num > remaining + 1e-9) {
          alert(
            `Amount exceeds remaining refundable balance (${remaining.toFixed(2)}).`
          );
          return;
        }
      }
      const refundResp = await refundCapture(captureId, amount);
      await loadTransactions();
      // Optimistic refresh of refund history to mitigate PayPal reporting lag
      setTimeout(() => {
        const cellId = `rh-${captureId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
        const cellEl = document.getElementById(cellId);
        const row = document.querySelector(`tr[data-capture="${captureId}"]`);
        const captureAmt = row ? Number(row.dataset.captureAmount) : undefined;
        if (cellEl) {
          renderRefundHistoryFromCapture(cellEl, captureId, captureAmt);
        }
      }, 400);

      alert("Refund done!");
    } catch (err) {
      console.error(err);
      alert(err.message);
      // If PayPal reports the capture is already fully refunded, refresh UI and disable actions
      if (err?.message && err.message.toLowerCase().includes("fully refunded")) {
        const captureId = btn.dataset.capture;
        // Mark row as fully refunded in UI (no local cache; just a visual hint)
        const row = document.querySelector(`tr[data-capture="${captureId}"]`);
        if (row) {
          row.dataset.remaining = "0";
          const input = row.querySelector(`input[data-capture="${captureId}"]`);
          const buttons = row.querySelectorAll(`button[data-capture="${captureId}"]`);
          if (input) input.disabled = true;
          buttons.forEach((b) => (b.disabled = true));

          const cellId = `rh-${captureId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
          const cellEl = document.getElementById(cellId);
          if (cellEl) {
            cellEl.innerHTML = `<span class="pill warn">Already fully refunded</span>`;
            const captureAmt = Number(row.dataset.captureAmount);
            renderRefundHistoryFromCapture(cellEl, captureId, captureAmt);
          }
        } else {
          await loadTransactions();
        }
      }
    } finally {
      btn.disabled = false;
    }
  }
});

if (refreshBtn) {
  refreshBtn.addEventListener("click", async () => {
    console.log("[backoffice] refresh click");
    try {
      await loadTransactions();
    } catch (e) {
      console.error(e);
      alert(e.message);
    }
  });
} else {
  console.warn("[backoffice] refreshBtn not found");
}

function setFlowFilter(next) {
  flowFilter = next;
  if (filterSellBtn && filterRefundsBtn) {
    filterSellBtn.classList.toggle("active", next === "sell");
    filterRefundsBtn.classList.toggle("active", next === "refund");
  }
  loadTransactions().catch((e) => {
    console.error(e);
    alert(e.message);
  });
}

if (filterSellBtn) {
  filterSellBtn.addEventListener("click", () => setFlowFilter("sell"));
}

if (filterRefundsBtn) {
  filterRefundsBtn.addEventListener("click", () => setFlowFilter("refund"));
}

// initial load
(async () => {
  console.log("[backoffice] initial load");
  try {
    await loadTransactions();
  } catch (e) {
    console.error("Initial load failed", e);
    alert(e.message);
  }
})();
