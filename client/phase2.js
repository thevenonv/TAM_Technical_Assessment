(() => {
  // DOM
  const carouselEl = document.getElementById("carousel");
  const selectedNameEl = document.getElementById("selectedName");
  const itemTotalEl = document.getElementById("itemTotal");
  document.getElementById("currencyLabel").textContent = CURRENCY;

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
  const fmt = (amount) => `$${Number(amount).toFixed(2)}`;

  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }
  function setNotice(el, type, msg) {
    el.className = `notice ${type || ""}`;
    el.textContent = msg;
    show(el);
  }

  function setActiveTab(which) {
    const isPayPal = which === "paypal";
    tabPayPal.classList.toggle("active", isPayPal);
    tabCard.classList.toggle("active", !isPayPal);
    panelPayPal.classList.toggle("hidden", !isPayPal);
    panelCard.classList.toggle("hidden", isPayPal);
  }

  function renderProducts() {
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
    selectedNameEl.textContent = selected.name;
    itemTotalEl.textContent = fmt(selected.price);
  }

  function readBuyerInfo() {
    const fullName = document.getElementById("fullName").value.trim();
    const email = document.getElementById("email").value.trim();
    const addr1 = document.getElementById("addr1").value.trim();
    const addr2 = document.getElementById("addr2").value.trim();
    const city = document.getElementById("city").value.trim();
    const state = document.getElementById("state").value.trim().toUpperCase();
    const zip = document.getElementById("zip").value.trim();
    const country = document.getElementById("country").value;

    return {
      fullName,
      email,
      address: {
        address_line_1: addr1,
        address_line_2: addr2 || undefined,
        admin_area_2: city,
        admin_area_1: state,
        postal_code: zip,
        country_code: country
      }
    };
  }

  async function createOrderOnServer() {
    if (!buyerInfo) throw new Error("Buyer info missing. Please complete the form first.");

    const res = await fetch(`${SERVER_BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currency: CURRENCY,
        amount: String(selected.price),
        sku: selected.id,
        name: selected.name,
        buyerInfo // ton backend peut ignorer si tu ne l’utilises pas
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Create order failed");
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

  tabPayPal.onclick = () => setActiveTab("paypal");
  tabCard.onclick = () => setActiveTab("card");

  buyerForm.onsubmit = (e) => {
    e.preventDefault();
    try {
      buyerInfo = readBuyerInfo();
      setNotice(buyerStatus, "success", "Buyer info saved. Choose a payment method below.");
      show(paymentSection);
      paymentSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setNotice(buyerStatus, "danger", err.message || "Invalid buyer info");
    }
  };

  editBuyerBtn.onclick = () => {
    paymentSection.scrollIntoView({ behavior: "smooth", block: "start" });
    // juste UX: on remonte au form
    document.getElementById("fullName").scrollIntoView({ behavior: "smooth", block: "center" });
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
    }
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
      }
    });

    if (!cardFields.isEligible()) {
      setNotice(cardEligibility, "warn", "Card Fields are not eligible in this sandbox/browser context.");
      cardPayBtn.disabled = true;
      return;
    }

    // render fields
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
        await cardFields.submit(); // triggers createOrder + onApprove
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