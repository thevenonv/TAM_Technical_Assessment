const SERVER_BASE = "http://localhost:3001";

const tbody = document.getElementById("liveTbody");
const logEl = document.getElementById("liveLog");
const pendingTbody = document.getElementById("pendingTbody");

function log(x) {
  logEl.textContent = (typeof x === "string" ? x : JSON.stringify(x, null, 2)) + "\n\n" + logEl.textContent;
}

function pill(text, type = "") {
  const cls = type ? `pill ${type}` : "pill";
  return `<span class="${cls}">${text}</span>`;
}

function money(amount, currency = "USD") {
  if (amount == null || Number.isNaN(Number(amount))) return "?";
  return `${currency} ${Number(amount).toFixed(2)}`;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

function renderRow(entry) {
  const tr = document.createElement("tr");
  const captureId = entry.captureId || "";
  const product = entry.product || {};
  const localStatus = entry.captureStatus || entry.status || "PENDING";

  const refunds = Array.isArray(entry.refunds) ? entry.refunds : [];
  const captureAmt = Number(entry.captureAmount ?? entry.amount);
  const refundedSum = refunds.reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
  const fullyRefunded =
    localStatus.toUpperCase() === "REFUNDED" ||
    (Number.isFinite(captureAmt) && refundedSum >= Math.abs(captureAmt) - 1e-2);
  const inputDisabled = !captureId || fullyRefunded;
  const buttonsDisabled = !captureId || fullyRefunded;

  // Display status prioritizes local refund knowledge
  let displayStatus = localStatus;
  let displayClass = "warn";
  if (refundedSum > 0) {
    if (fullyRefunded) {
      displayStatus = "REFUNDED (local)";
      displayClass = "ok";
    } else {
      displayStatus = "PARTIAL (local)";
      displayClass = "warn";
    }
  } else if (localStatus.toUpperCase() === "COMPLETED" || localStatus.toUpperCase() === "CAPTURED") {
    displayClass = "ok";
  }
  const localStatusPill = pill(displayStatus, displayClass);

  tr.dataset.capture = captureId;
  tr.dataset.order = entry.orderID || "";
  tr.dataset.status = localStatus.toUpperCase();
  tr.dataset.ppStatus = "";
  tr.dataset.ppRefundTotal = "";
  tr.dataset.refundedSum = refundedSum;
  tr.dataset.remaining =
    Number.isFinite(captureAmt) && !fullyRefunded ? Math.max(0, Math.abs(captureAmt) - refundedSum) : 0;
  tr.innerHTML = `
    <td><code>${entry.orderID || "-"}</code></td>
    <td><code>${captureId || "-"}</code></td>
    <td>${product.name || product.sku || "-"}</td>
    <td>${money(entry.captureAmount ?? entry.amount, entry.currency)}</td>
    <td>${localStatusPill}</td>
    <td id="pp-${captureId || entry.orderID || Math.random().toString(16).slice(2)}">${pill("Not checked")}</td>
    <td>
      <input class="amt" placeholder="(full)" data-capture="${captureId}" ${inputDisabled ? "disabled" : ""} />
      <div style="display:flex; gap:6px; margin-top:6px;">
        <button class="ghost" data-action="refund" data-capture="${captureId}" ${buttonsDisabled ? "disabled" : ""}>Partial</button>
        <button data-action="full-refund" data-capture="${captureId}" ${buttonsDisabled ? "disabled" : ""}>Full</button>
        <button class="ghost" data-action="check" data-capture="${captureId}" ${captureId ? "" : "disabled"}>Check PayPal</button>
      </div>
      <div class="mini">
        Refunded: ${refunds.length ? money(refundedSum, entry.currency) : "0.00"}
        ${fullyRefunded ? pill("Fully refunded", "warn") : ""}
      </div>
    </td>
  `;
  return tr;
}

async function loadLocal() {
  tbody.innerHTML = `<tr><td colspan="7">Loading...</td></tr>`;
  if (pendingTbody) pendingTbody.innerHTML = `<tr><td colspan="4">Loading...</td></tr>`;
  try {
    const data = await fetchJson(`${SERVER_BASE}/api/local/transactions`);
    let entries = data.entries || [];
    // drop entries without orderID (avoid anonymous rows)
    entries = entries.filter((e) => e.orderID);

    if (!entries.length) {
      tbody.innerHTML = `<tr><td colspan="7">No entries.</td></tr>`;
      if (pendingTbody) pendingTbody.innerHTML = `<tr><td colspan="4">No pending items.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    entries
      .sort((a, b) => {
        const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
        const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return tb - ta;
      })
      .forEach((entry) => tbody.appendChild(renderRow(entry)));

    // Trigger PayPal checks for rows that have a captureId
    Array.from(tbody.querySelectorAll("tr")).forEach((tr) => {
      const capId = tr.dataset.capture;
      const cellId = tr.querySelector("td:nth-child(6)")?.id;
      if (capId && cellId) {
        checkPayPal(capId, cellId)
          .catch((e) => console.warn("PayPal check failed", e))
          .finally(() => updatePendingFromDom());
      }
    });

    // initial pending before any PayPal reconciliation
    updatePendingFromDom();
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="7" style="color:#fca5a5;">${err.message}</td></tr>`;
    if (pendingTbody) pendingTbody.innerHTML = `<tr><td colspan="4" style="color:#fca5a5;">${err.message}</td></tr>`;
  }
}

async function checkPayPal(captureId, cellId) {
  if (!captureId) return;
  const cell = document.getElementById(cellId);
  if (cell) cell.innerHTML = pill("Checking...", "warn");
  try {
    const data = await fetchJson(`${SERVER_BASE}/api/admin/captures/${encodeURIComponent(captureId)}`);
    const refundResp = await fetchJson(
      `${SERVER_BASE}/api/admin/captures/${encodeURIComponent(captureId)}/refunds`,
    ).catch((e) => {
      console.warn("Refunds fetch failed", e);
      return null;
    });

    const status = (data.capture?.status || "").toUpperCase() || "UNKNOWN";
    const amt = data.capture?.amount?.value;
    const cur = data.capture?.amount?.currency_code || "USD";
    const msg = `${status} ${amt ? money(amt, cur) : ""}`.trim();

    // Compute total refunds strictly from PayPal APIs
    let ppRefundTotal = 0;
    if (refundResp) {
      const refunds = refundResp.refunds?.refunds || refundResp.refunds?.items || refundResp.refunds || [];
      ppRefundTotal = refunds.reduce((s, r) => s + Math.abs(Number(r.amount?.value || 0)), 0);
      // If PayPal marks REFUNDED but list is empty, assume full capture amount
      if ((!refunds || !refunds.length) && status === "REFUNDED" && Number.isFinite(Number(amt))) {
        ppRefundTotal = Math.abs(Number(amt));
      }
    }

    const row = document.querySelector(`tr[data-capture="${captureId}"]`);
    const localRefunded = row ? Number(row.dataset.refundedSum || 0) : 0;
    if (row) {
      row.dataset.ppRefundTotal = String(ppRefundTotal || "");
      row.dataset.ppStatus = status;
    }

    if (cell) {
      const mismatch =
        Number.isFinite(localRefunded) && Math.abs(ppRefundTotal - localRefunded) > 0.01;
      const statusClass =
        (status === "REFUNDED" || status === "COMPLETED" || status === "CAPTURED") && !mismatch ? "ok" : "warn";
      const statusPill = pill(msg, statusClass);
      let refundLabel;
      if (ppRefundTotal || ppRefundTotal === 0) {
        refundLabel = `PP refunds ${money(ppRefundTotal, cur)}${
          mismatch ? ` (local ${money(localRefunded, cur)})` : ""
        }`;
      } else {
        refundLabel = "PP refunds n/a";
      }
      const refundPill = pill(refundLabel, mismatch ? "warn" : "ok");
      cell.innerHTML = `${statusPill} ${refundPill}`;
    }
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
    updatePendingFromDom();
    return data;
  } catch (err) {
    if (cell) cell.innerHTML = pill(err.message || "PayPal error", "danger");
    updatePendingFromDom();
    throw err;
  }
}

async function refundCapture(captureId, amount) {
  const payload = { captureId };
  if (amount && amount.trim() !== "") {
    const num = Number(amount.trim());
    if (!Number.isFinite(num) || num <= 0) {
      alert("Amount must be > 0 for partial refund.");
      return;
    }
    payload.amount = amount.trim();
  }
  const data = await fetchJson(`${SERVER_BASE}/api/admin/refunds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  log({ refund: data.refundId, status: data.refund?.status, amount: data.refund?.amount });
  alert("Refund done!");
  return data;
}

tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const action = btn.dataset.action;
  const captureId = btn.dataset.capture;
  if (!captureId) return alert("Missing captureId");

  if (action === "check") {
    const cellId = btn.parentElement?.parentElement?.previousElementSibling?.id;
    try {
      await checkPayPal(captureId, cellId);
    } catch (err) {
      console.error(err);
    }
    return;
  }

  if (action === "refund" || action === "full-refund") {
    const input = tbody.querySelector(`input[data-capture="${captureId}"]`);
    const row = btn.closest("tr");
    const remaining = row ? Number(row.dataset.remaining) : null;
    const amount =
      action === "full-refund"
        ? Number.isFinite(remaining) ? remaining.toFixed(2) : ""
        : input
        ? input.value
        : "";
    btn.disabled = true;
    try {
      await refundCapture(captureId, amount);
      await loadLocal();
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  }
});

document.getElementById("refreshLocal").onclick = () => loadLocal();

loadLocal().catch((e) => {
  console.error(e);
  alert(e.message);
});

function updatePendingFromDom() {
  if (!pendingTbody) return;
  const rows = Array.from(tbody.querySelectorAll("tr"));
  const pending = rows
    .map((tr) => {
      const orderID = tr.dataset.order || "";
      const captureId = tr.dataset.capture || "";
      const refunded = Number(tr.dataset.refundedSum || 0);
      const ppRefundTotalRaw = tr.dataset.ppRefundTotal;
      const ppRefundTotal = ppRefundTotalRaw === "" || ppRefundTotalRaw == null ? null : Number(ppRefundTotalRaw);
      const ppStatus = (tr.dataset.ppStatus || "").toUpperCase();
      const localStatus = (tr.dataset.status || "").toUpperCase();
      const captureAmt = Number(tr.dataset.remaining || 0) + refunded;

      const fullyRefundedLocal = Number.isFinite(captureAmt) && refunded >= Math.abs(captureAmt) - 1e-2;
      const ppKnownRefund = ppStatus === "REFUNDED" || ppStatus === "PARTIALLY_REFUNDED";
      const ppLessThanLocal =
        ppRefundTotal != null && Number.isFinite(ppRefundTotal) && refunded > ppRefundTotal + 1e-2;
      const ppMissing = ppRefundTotal == null || Number.isNaN(ppRefundTotal);

      // Pending if we have local refunds and either PayPal hasn't caught up, or reports less than local
      const shouldPending =
        refunded > 0 &&
        ((!ppKnownRefund && (ppMissing || ppLessThanLocal)) ||
          (ppKnownRefund && ppLessThanLocal) ||
          (!fullyRefundedLocal && ppMissing));

      return shouldPending
        ? { orderID, captureId, refunded, status: ppStatus || localStatus || "PENDING" }
        : null;
    })
    .filter(Boolean);

  if (!pending.length) {
    pendingTbody.innerHTML = `<tr><td colspan="4">No pending items.</td></tr>`;
    return;
  }

  pendingTbody.innerHTML = "";
  pending.forEach((p) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${p.orderID || "-"}</code></td>
      <td><code>${p.captureId || "-"}</code></td>
      <td>${money(p.refunded)}</td>
      <td>${pill(p.status || "PENDING", "warn")}</td>
    `;
    pendingTbody.appendChild(tr);
  });
}
