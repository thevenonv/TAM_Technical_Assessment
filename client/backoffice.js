const SERVER_BASE = "http://localhost:3001";

const tbody = document.getElementById("tbody");
const logEl = document.getElementById("log");
const refreshBtn = document.getElementById("refreshBtn");
const filterSellBtn = document.getElementById("filterSell");
const filterRefundsBtn = document.getElementById("filterRefunds");

let flowFilter = "sell"; // "sell" -> positive amounts, "refund" -> negative amounts
const localRefunds = {}; // optimistic refunds per captureId

function log(x) {
  logEl.textContent =
    (typeof x === "string" ? x : JSON.stringify(x, null, 2)) + "\n\n" + logEl.textContent;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
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

async function renderRefundHistory(cellEl, refundIds) {
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
        const amt = r.amount == null ? "?" : Number(r.amount).toFixed(2);
        return `
          <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:6px;">
            ${pill(r.status)}
            <span class="pill">${r.currency} ${amt}</span>
            <span class="pill"><code>${r.id}</code></span>
            <span class="pill">${fmtTime(r.create_time)}</span>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    cellEl.innerHTML = `<span class="pill danger">${err.message}</span>`;
  }
}

async function renderRefundHistoryFromCapture(cellEl, captureId) {
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

    if (!refunds.length) {
      cellEl.textContent = "No refunds";
      return;
    }

    cellEl.innerHTML = refunds
      .map((r) => {
        const amt = r.amount?.value != null ? Number(r.amount.value).toFixed(2) : "?";
        const cur = r.amount?.currency_code || "USD";
        const t = r.create_time ? fmtTime(r.create_time) : "";
        return `
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:6px;">
          <span class="pill">${cur} ${amt}</span>
          ${t ? `<span class="pill">${t}</span>` : ""}
        </div>
      `;
      })
      .join("");
  } catch (err) {
    // If PayPal says 404/NO REFUNDS, render empty
    cellEl.innerHTML = err.message && err.message.includes("404")
      ? "No refunds yet"
      : `<span class="pill danger">${err.message}</span>`;
  }
}

function renderRefundHistoryInline(cellEl, refunds) {
  if (!refunds || !refunds.length) {
    cellEl.textContent = "No refunds yet";
    return;
  }

  cellEl.innerHTML = refunds
    .map((r) => {
      const amt = r.amount?.value != null ? Number(r.amount.value).toFixed(2) : "?";
      const cur = r.amount?.currency_code || "USD";
      const t = r.create_time ? fmtTime(r.create_time) : "";
      return `
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:6px;">
          <span class="pill">${cur} ${amt}</span>
          ${t ? `<span class="pill">${t}</span>` : ""}
        </div>
      `;
    })
    .join("");
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
  const filtered = txs.filter((tx) => {
    const n = Number(tx.amount);
    if (!Number.isFinite(n)) return true;
    if (flowFilter === "sell") return n > 0;
    if (flowFilter === "refund") return n < 0;
    return true;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7">No transactions for this filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";

  for (const tx of filtered) {
    const tr = document.createElement("tr");

    const captureId = tx.captureId || "";
    const refundCellId = `rh-${captureId.replace(/[^a-zA-Z0-9_-]/g, "") || Math.random().toString(16).slice(2)}`;

    const amtNum = Number(tx.amount);
    const isRefundFlow = Number.isFinite(amtNum) && amtNum < 0;
    const historyId = isRefundFlow ? (tx.orderID || captureId) : captureId;
    const refundsFromApi = refundMap[captureId] || refundMap[tx.orderID] || [];
    const refundsLocal = localRefunds[captureId] || [];
    const refundsForCapture = [...refundsFromApi, ...refundsLocal];
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

    tr.innerHTML = `
      <td><code>${tx.orderID || "?"}</code></td>
      <td><code>${captureId || "?"}</code></td>
      <td>${tx.error ? "?" : money(tx)}</td>
      <td>
        <input class="amt" placeholder="(full)" data-capture="${captureId}" ${
          isRefundFlow || isFullyRefunded ? "disabled" : ""
        } />
      </td>
      <td>
        <button class="ghost" data-action="refund" data-capture="${captureId}" ${
          isRefundFlow || isFullyRefunded ? "disabled" : ""
        }>Partial refund</button>
        <button data-action="full-refund" data-capture="${captureId}" ${
          isRefundFlow || isFullyRefunded ? "disabled" : ""
        }>Full refund</button>
      </td>
      <td id="${refundCellId}">
        ${tx.error ? `<span class="pill danger">${tx.error}</span>` : `<span class="pill">No refunds yet</span>`}
      </td>
    `;

    tbody.appendChild(tr);

    if (!tx.error) {
      const cellEl = document.getElementById(refundCellId);
      if (isRefundFlow) {
        cellEl.textContent = "-";
      } else if (refundsForCapture && refundsForCapture.length) {
        renderRefundHistoryInline(cellEl, refundsForCapture);
      } else if (!historyId) {
        cellEl.innerHTML = `<span class="pill">No refunds yet</span>`;
      } else {
        renderRefundHistoryFromCapture(cellEl, historyId);
      }
    }

    // disable actions if amount field is empty
    const amtInput = tr.querySelector(`input[data-capture="${captureId}"]`);
    const buttons = tr.querySelectorAll(`button[data-capture="${captureId}"]`);
    const toggleButtons = () => {
      // Keep buttons enabled visually; validation happens on click
    };
    if (amtInput) {
      amtInput.addEventListener("input", toggleButtons);
      toggleButtons();
    }
  }
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

  // Optimistic cache of the new refund for immediate UI update
  const cacheCaptureId = payload.captureId;
  const existing = localRefunds[cacheCaptureId] || [];
  const refundEntry = {
    id: data.refund?.id || data.refundId,
    status: data.refund?.status,
    amount: data.refund?.amount || (payload.amount ? { value: payload.amount, currency_code: "USD" } : null),
    create_time: data.refund?.create_time || new Date().toISOString(),
  };
  localRefunds[cacheCaptureId] = [refundEntry, ...existing];

  return data; // allow caller to optimistically refresh history
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
        if (cellEl) {
          renderRefundHistoryFromCapture(cellEl, captureId);
        }
      }, 400);

      alert("Refund done!");
    } catch (err) {
      console.error(err);
      alert(err.message);
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

