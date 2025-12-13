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
    cellEl.textContent = "No refunds yet";
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
      cellEl.textContent = "No refunds yet";
      return;
    }

    cellEl.innerHTML = refunds
      .map((r) => {
        const status = r.status || "?";
        const amt = r.amount?.value != null ? Number(r.amount.value).toFixed(2) : "?";
        const cur = r.amount?.currency_code || "USD";
        const id = r.id || "";
        const t = r.create_time ? fmtTime(r.create_time) : "";
        return `
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:6px;">
          ${pill(status)}
          <span class="pill">${cur} ${amt}</span>
          <span class="pill"><code>${id}</code></span>
          ${t ? `<span class="pill">${t}</span>` : ""}
        </div>
      `;
      })
      .join("");
  } catch (err) {
    // If PayPal says 404/NO REFUNDS, server already returns ok with empty list.
    cellEl.innerHTML = `<span class="pill danger">${err.message}</span>`;
  }
}

function renderRefundHistoryInline(cellEl, refunds) {
  if (!refunds || !refunds.length) {
    cellEl.textContent = "No refunds yet";
    return;
  }

  cellEl.innerHTML = refunds
    .map((r) => {
      const status = r.status || "?";
      const amt = r.amount?.value != null ? Number(r.amount.value).toFixed(2) : "?";
      const cur = r.amount?.currency_code || "USD";
      const id = r.id || r.captureId || "";
      const t = r.create_time ? fmtTime(r.create_time) : "";
      return `
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:6px;">
          ${pill(status)}
          <span class="pill">${cur} ${amt}</span>
          <span class="pill"><code>${id}</code></span>
          ${t ? `<span class="pill">${t}</span>` : ""}
        </div>
      `;
    })
    .join("");
}

async function loadTransactions() {
  tbody.innerHTML = `<tr><td colspan="7">Loading…</td></tr>`;
  const res = await fetch(`${SERVER_BASE}/api/admin/transactions`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load transactions");

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

    const statusHtml = tx.error ? `<span class="pill danger">ERROR</span>` : pill(tx.status);

    const captureId = tx.captureId || "";
    const refundCellId = `rh-${captureId.replace(/[^a-zA-Z0-9_-]/g, "") || Math.random().toString(16).slice(2)}`;

    const amtNum = Number(tx.amount);
    const isRefundFlow = Number.isFinite(amtNum) && amtNum < 0;
    const historyId = isRefundFlow ? (tx.orderID || captureId) : captureId;
    const refundsForCapture = refundMap[captureId] || refundMap[tx.orderID];

    tr.innerHTML = `
      <td><code>${tx.orderID || "?"}</code></td>
      <td><code>${captureId || "?"}</code></td>
      <td>${tx.error ? "?" : money(tx)}</td>
      <td>${statusHtml}</td>
      <td>
        <input class="amt" placeholder="(full)" data-capture="${captureId}" ${isRefundFlow ? "disabled" : ""} />
      </td>
      <td>
        <button class="ghost" data-action="refund" data-capture="${captureId}" ${isRefundFlow ? "disabled" : ""}>Partial refund</button>
        <button data-action="full-refund" data-capture="${captureId}" ${isRefundFlow ? "disabled" : ""}>Full refund</button>
      </td>
      <td id="${refundCellId}">
        ${tx.error ? `<span class="pill danger">${tx.error}</span>` : `<span class="pill">No refunds yet</span>`}
      </td>
    `;

    tbody.appendChild(tr);

    if (!tx.error) {
      const cellEl = document.getElementById(refundCellId);
      if (isRefundFlow) {
        // In refunds tab, history column not useful -> show dash
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
      const val = amtInput ? amtInput.value.trim() : "";
      const shouldDisable = val === "";
      buttons.forEach((b) => {
        if (!isRefundFlow) b.disabled = shouldDisable;
      });
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
  }

  const res = await fetch(`${SERVER_BASE}/api/admin/refunds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Refund failed");

  log({
    ok: true,
    refundId: data.refundId,
    status: data.refund?.status,
    amount: data.refund?.amount,
    debugId: data.debugId,
  });
}

tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  if (btn.dataset.action === "refund" || btn.dataset.action === "full-refund") {
    const captureId = btn.dataset.capture;
    const input = document.querySelector(`input[data-capture="${captureId}"]`);
    const amount = btn.dataset.action === "full-refund" ? "" : input ? input.value : "";

    btn.disabled = true;
    try {
      await refundCapture(captureId, amount);
      await loadTransactions();
      alert("Refund done!");
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  }
});

refreshBtn.addEventListener("click", async () => {
  try {
    await loadTransactions();
  } catch (e) {
    console.error(e);
    alert(e.message);
  }
});

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
  try {
    await loadTransactions();
  } catch (e) {
    console.error(e);
    alert(e.message);
  }
})();
