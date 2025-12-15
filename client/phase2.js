(() => {
  // DOM lookups
  const carouselEl = document.getElementById("carousel");
  const selectedNameEl = document.getElementById("selectedName");
  const itemTotalEl = document.getElementById("itemTotal");
  const currencyLabelEl = document.getElementById("currencyLabel");

  const buyerForm = document.getElementById("buyerForm");
  const buyerStatus = document.getElementById("buyerStatus");
  const paymentSection = document.getElementById("paymentSection");

  const tabPayPal = document.getElementById("tabPayPal");
  const tabCard = document.getElementById("tabCard");
  const panelPayPal = document.getElementById("panelPayPal");
  const panelCard = document.getElementById("panelCard");

  const paypalStatus = document.getElementById("paypalStatus");
  const globalStatus = document.getElementById("globalStatus");

  const cardEligibility = document.getElementById("cardEligibility");
  const cardStatus = document.getElementById("cardStatus");
  const cardPayBtn = document.getElementById("cardPayBtn");
  const editBuyerBtn = document.getElementById("editBuyerBtn");

  // state
  let buyerInfo = null;

  // helpers
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

  const fmt = (amount) => `$${Number(amount).toFixed(2)}`;

  function show(el) { el && el.classList.remove("hidden"); }
  function hide(el) { el && el.classList.add("hidden"); }
  function setNotice(el, type, msg) {
    if (!el) return;
    el.className = `notice ${type || ""}`;
    el.textContent = msg;
    show(el);
  }

  function setActiveTab(which) {
    const isPayPal = which === "paypal";
    tabPayPal?.classList.toggle("active", isPayPal);
    tabCard?.classList.toggle("active", !isPayPal);
    panelPayPal?.classList.toggle("hidden", !isPayPal);
    panelCard?.classList.toggle("hidden", isPayPal);
  }

  function renderProducts() {
    if (!carouselEl || !Array.isArray(products)) return;
    carouselEl.innerHTML = "";
    for (const p of products) {
      const div = document.createElement("div");
      div.className = "product" + (p.id === selected.id ? " selected" : "");
      div.innerHTML = `
        <img src="${p.img}" alt="${p.name}" loading="lazy" />
        <div class="name">${p.name}</div>
        <div class="meta">
          <span>${CURRENCY}</span>
          <b>${Number(p.price).toFixed(2)}</b>
        </div>
      `;
      div.onclick = () => {
        selected = p;
        updateSummary();
        renderProducts();
      };
      carouselEl.appendChild(div);
    }
  }

  function updateSummary() {
    if (selectedNameEl) selectedNameEl.textContent = selected.name;
    if (itemTotalEl) itemTotalEl.textContent = fmt(selected.price);
    if (currencyLabelEl) currencyLabelEl.textContent = CURRENCY;
  }

  function readBuyerInfo() {
    const fullName = document.getElementById("fullName")?.value.trim();
    const email = document.getElementById("email")?.value.trim();
    const addr1 = document.getElementById("addr1")?.value.trim();
    const addr2 = document.getElementById("addr2")?.value.trim();
    const city = document.getElementById("city")?.value.trim();
    const state = document.getElementById("state")?.value.trim().toUpperCase();
    const zip = document.getElementById("zip")?.value.trim();
    const country = document.getElementById("country")?.value;

    return {
      fullName,
      email,
      address: {
        address_line_1: addr1,
        address_line_2: addr2 || undefined,
        admin_area_2: city,
        admin_area_1: state,
        postal_code: zip,
        country_code: country,
      },
    };
  }

  function validateBuyerInfo(info) {
    const errs = [];
    if (!info.fullName) errs.push("Full name is required.");
    const a = info.address || {};
    if (!a.address_line_1) errs.push("Address line 1 is required.");
    if (!a.admin_area_2) errs.push("City is required.");
    if (!a.admin_area_1 || a.admin_area_1.length !== 2) errs.push("State must be 2 letters.");
    if (!a.postal_code) errs.push("Postal code is required.");
    else if (!/^[0-9]{5}$/.test(a.postal_code)) errs.push("Postal code must be 5 digits.");
    if (!a.country_code) errs.push("Country is required.");
    if (info.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email)) {
      errs.push("Email format is invalid.");
    }
    return errs;
  }

  async function createOrderOnServer() {
    if (!buyerInfo) throw new Error("Buyer info missing. Please complete the form first.");

    const data = await fetchJson(`${SERVER_BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currency: CURRENCY,
        amount: String(selected.price),
        sku: selected.id,
        name: selected.name,
        buyerInfo,
      }),
    });

    return data.orderID;
  }

  function goToReview(orderID) {
    window.location.href =
      `review.html?orderID=${encodeURIComponent(orderID)}` +
      `&itemTotal=${encodeURIComponent(selected.price)}` +
      `&currency=${encodeURIComponent(CURRENCY)}` +
      `&sku=${encodeURIComponent(selected.id)}` +
      `&name=${encodeURIComponent(selected.name)}`;
  }

  // init UI
  renderProducts();
  updateSummary();
  setActiveTab("paypal");

  tabPayPal && (tabPayPal.onclick = () => setActiveTab("paypal"));
  tabCard && (tabCard.onclick = () => setActiveTab("card"));

  buyerForm.onsubmit = (e) => {
    e.preventDefault();
    const info = readBuyerInfo();
    const errs = validateBuyerInfo(info);
    if (errs.length) {
      setNotice(buyerStatus, "danger", errs.join(" "));
      hide(paymentSection);
      buyerInfo = null;
      return;
    }
    buyerInfo = info;
    setNotice(buyerStatus, "success", "Buyer info saved. Choose a payment method below.");
    show(paymentSection);
    paymentSection?.scrollIntoView({ behavior: "smooth", block: "start" });
    hide(globalStatus);
    hide(paypalStatus);
    hide(cardStatus);
  };

  editBuyerBtn.onclick = () => {
    document.getElementById("fullName")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // PAYPAL BUTTONS
  paypal.Buttons({
    createOrder: async () => {
      hide(globalStatus);
      setNotice(paypalStatus, "", "Creating order…");
      const orderID = await createOrderOnServer();
      setNotice(paypalStatus, "success", `Order created: ${orderID}`);
      return orderID;
    },
    onApprove: (data) => goToReview(data.orderID),
    onError: (err) => {
      console.error(err);
      setNotice(globalStatus, "danger", "PayPal error: " + (err?.message || String(err)));
      alert("PayPal error: " + (err?.message || String(err)));
    },
  }).render("#paypal-button-container");

  // CARD FIELDS
  try {
    if (!paypal.CardFields) {
      setNotice(cardEligibility, "warn", "Card Fields not available. Check SDK has components=buttons,card-fields.");
      cardPayBtn.disabled = true;
      return;
    }

    const cardFields = paypal.CardFields({
      createOrder: async () => {
        setNotice(cardStatus, "", "Creating order for card payment…");
        const orderID = await createOrderOnServer();
        setNotice(cardStatus, "success", `Order created: ${orderID}. Submitting card…`);
        return orderID;
      },
      onApprove: (data) => goToReview(data.orderID),
      onError: (err) => {
        console.error(err);
        setNotice(cardStatus, "danger", "Card error: " + (err?.message || String(err)));
      },
    });

    if (!cardFields.isEligible()) {
      setNotice(cardEligibility, "warn", "Card Fields are not eligible in this sandbox/browser context.");
      cardPayBtn.disabled = true;
      return;
    }

    cardFields.NumberField().render("#card-number");
    cardFields.ExpiryField().render("#card-expiry");
    cardFields.CVVField().render("#card-cvv");

    cardPayBtn.onclick = async () => {
      try {
        if (!buyerInfo) {
          alert("Please complete Buyer information first.");
          return;
        }
        cardPayBtn.disabled = true;
        cardPayBtn.textContent = "Processing…";
        await cardFields.submit();
      } catch (e) {
        console.error(e);
        setNotice(cardStatus, "danger", e.message || "Card submit failed");
        cardPayBtn.disabled = false;
        cardPayBtn.textContent = "Pay with card";
      }
    };
  } catch (e) {
    console.error(e);
    setNotice(cardEligibility, "warn", "Card Fields init failed. Check console.");
    cardPayBtn.disabled = true;
  }
})();
