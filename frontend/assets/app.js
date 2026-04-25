const config = window.GitShopConfig || {};
const usernamePattern = /^[A-Za-z0-9_]{3,16}$/;

const state = {
  catalog: [],
  cart: loadCart(),
  activeCategory: "All",
  currentOrder: loadCurrentOrder()
};

const elements = {
  catalogGrid: document.querySelector("#catalogGrid"),
  categoryFilters: document.querySelector("#categoryFilters"),
  cartItems: document.querySelector("#cartItems"),
  cartCount: document.querySelector("#cartCount"),
  cartSubtotal: document.querySelector("#cartSubtotal"),
  checkoutForm: document.querySelector("#checkoutForm"),
  usernameInput: document.querySelector("#usernameInput"),
  orderNumberInput: document.querySelector("#orderNumberInput"),
  checkoutMessage: document.querySelector("#checkoutMessage"),
  connectionBadge: document.querySelector("#connectionBadge"),
  orderPanel: document.querySelector("#orderPanel"),
  orderHeadline: document.querySelector("#orderHeadline"),
  orderSummary: document.querySelector("#orderSummary"),
  mockPayButton: document.querySelector("#mockPayButton"),
  resetOrderButton: document.querySelector("#resetOrderButton"),
  verifyForm: document.querySelector("#verifyForm"),
  verifyOrderInput: document.querySelector("#verifyOrderInput")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem("gitshop.cart") || "[]");
  } catch (error) {
    return [];
  }
}

function persistCart() {
  localStorage.setItem("gitshop.cart", JSON.stringify(state.cart));
}

function loadCurrentOrder() {
  try {
    return JSON.parse(localStorage.getItem("gitshop.order") || "null");
  } catch (error) {
    return null;
  }
}

function persistCurrentOrder() {
  if (!state.currentOrder) {
    localStorage.removeItem("gitshop.order");
    return;
  }
  localStorage.setItem("gitshop.order", JSON.stringify(state.currentOrder));
}

function formatMoney(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: config.currency || "USD"
  }).format((cents || 0) / 100);
}

async function api(path, options = {}) {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({
    ok: false,
    error: "Invalid response from backend"
  }));

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

function setMessage(text, tone = "neutral") {
  if (!text) {
    elements.checkoutMessage.hidden = true;
    elements.checkoutMessage.textContent = "";
    elements.checkoutMessage.dataset.tone = "";
    return;
  }

  elements.checkoutMessage.hidden = false;
  elements.checkoutMessage.textContent = text;
  elements.checkoutMessage.dataset.tone = tone;
}

function getCartQuantity() {
  return state.cart.reduce((sum, item) => sum + item.quantity, 0);
}

function getCartSubtotal() {
  return state.cart.reduce((sum, item) => {
    const product = state.catalog.find((entry) => entry.id === item.productId);
    return sum + (product ? product.priceCents * item.quantity : 0);
  }, 0);
}

function pruneMissingCartItems() {
  const productIds = new Set(state.catalog.map((product) => product.id));
  const filteredCart = state.cart.filter((item) => productIds.has(item.productId));

  if (filteredCart.length !== state.cart.length) {
    state.cart = filteredCart;
    persistCart();
  }
}

function renderFilters() {
  const categories = ["All", ...new Set(state.catalog.map((item) => item.category))];
  if (!categories.includes(state.activeCategory)) {
    state.activeCategory = "All";
  }

  elements.categoryFilters.innerHTML = categories
    .map((category) => {
      const activeClass = category === state.activeCategory ? "active-filter" : "";
      return `<button class="filter-chip ${activeClass}" type="button" data-category="${escapeAttribute(category)}">${escapeHtml(category)}</button>`;
    })
    .join("");

  elements.categoryFilters.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeCategory = button.dataset.category;
      renderFilters();
      renderCatalog();
    });
  });
}

function renderCatalog() {
  const visibleProducts = state.catalog.filter((product) => {
    return state.activeCategory === "All" || product.category === state.activeCategory;
  });

  if (visibleProducts.length === 0) {
    elements.catalogGrid.innerHTML = `<div class="empty-state">No products match this filter.</div>`;
    return;
  }

  elements.catalogGrid.innerHTML = visibleProducts
    .map((product, index) => {
      const displayIcon = product.icon || product.name.slice(0, 2).toUpperCase();
      const media = product.imageUrl
        ? `<img class="product-image" src="${escapeAttribute(product.imageUrl)}" alt="${escapeAttribute(product.name)}">`
        : `<div class="product-image-fallback">${escapeHtml(displayIcon)}</div>`;

      return `
        <article class="product-card" style="--accent:${product.accent}; animation-delay:${index * 80}ms">
          <div class="product-media">${media}</div>
          <div class="product-card-top">
            <span class="product-category">${escapeHtml(product.category)}</span>
            <strong>${formatMoney(product.priceCents)}</strong>
          </div>
          <div class="product-copy">
            <h3>${escapeHtml(product.name)}</h3>
            <p>${escapeHtml(product.description)}</p>
          </div>
          <div class="product-card-bottom">
            <button class="button" type="button" data-add="${escapeAttribute(product.id)}">Add to cart</button>
          </div>
        </article>
      `;
    })
    .join("");

  elements.catalogGrid.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => addToCart(button.dataset.add));
  });
}

function renderCart() {
  const quantity = getCartQuantity();
  const subtotal = getCartSubtotal();

  elements.cartCount.textContent = `${quantity} item${quantity === 1 ? "" : "s"}`;
  elements.cartSubtotal.textContent = formatMoney(subtotal);

  if (state.cart.length === 0) {
    elements.cartItems.innerHTML = `<div class="empty-state">Select products from the catalog to start building an order.</div>`;
    return;
  }

  elements.cartItems.innerHTML = state.cart
    .map((item) => {
      const product = state.catalog.find((entry) => entry.id === item.productId);
      if (!product) {
        return "";
      }

      return `
        <div class="cart-item">
          <div>
            <strong>${escapeHtml(product.name)}</strong>
            <p>${escapeHtml(product.category)}</p>
          </div>
          <div class="cart-item-controls">
            <button class="stepper" type="button" data-step="${escapeAttribute(product.id)}" data-change="-1">-</button>
            <span>${item.quantity}</span>
            <button class="stepper" type="button" data-step="${escapeAttribute(product.id)}" data-change="1">+</button>
          </div>
        </div>
      `;
    })
    .join("");

  elements.cartItems.querySelectorAll("[data-step]").forEach((button) => {
    button.addEventListener("click", () => {
      updateQuantity(button.dataset.step, Number.parseInt(button.dataset.change, 10));
    });
  });
}

function renderOrder() {
  if (!state.currentOrder) {
    elements.orderPanel.hidden = true;
    return;
  }

  const order = state.currentOrder;
  elements.orderPanel.hidden = false;
  elements.orderHeadline.textContent =
    order.payment.status === "paid" ? "Payment captured" : "Awaiting payment";

  const lines = order.lineItems
    .map((item) => `<li>${item.quantity}x ${escapeHtml(item.name)}</li>`)
    .join("");

  elements.orderSummary.innerHTML = `
    <dl class="summary-grid">
      <div>
        <dt>Player</dt>
        <dd>${escapeHtml(order.username)}</dd>
      </div>
      <div>
        <dt>Order number</dt>
        <dd>${escapeHtml(order.orderNumber)}</dd>
      </div>
      <div>
        <dt>Payment</dt>
        <dd>${escapeHtml(order.payment.status)}</dd>
      </div>
      <div>
        <dt>Delivery</dt>
        <dd>${escapeHtml(order.delivery.status)}</dd>
      </div>
      <div>
        <dt>Subtotal</dt>
        <dd>${formatMoney(order.totals.subtotalCents)}</dd>
      </div>
      <div>
        <dt>Reference</dt>
        <dd>${escapeHtml(order.payment.reference || "Pending mock checkout")}</dd>
      </div>
    </dl>
    <div class="summary-list">
      <span>Items</span>
      <ul>${lines}</ul>
    </div>
  `;

  elements.mockPayButton.textContent = order.payment.status === "paid" ? "Payment received" : "Simulate payment";
  elements.mockPayButton.disabled = order.payment.status === "paid";
}

function addToCart(productId) {
  const existing = state.cart.find((item) => item.productId === productId);
  if (existing) {
    existing.quantity += 1;
  } else {
    state.cart.push({ productId, quantity: 1 });
  }

  persistCart();
  renderCart();
}

function updateQuantity(productId, change) {
  state.cart = state.cart
    .map((item) => {
      if (item.productId !== productId) {
        return item;
      }
      return {
        ...item,
        quantity: item.quantity + change
      };
    })
    .filter((item) => item.quantity > 0);

  persistCart();
  renderCart();
}

async function loadHealth() {
  try {
    const health = await api("/health", { headers: {} });
    elements.connectionBadge.textContent = `${health.status} via ${health.paymentProvider}`;
    elements.connectionBadge.dataset.tone = "success";
  } catch (error) {
    elements.connectionBadge.textContent = "Backend offline";
    elements.connectionBadge.dataset.tone = "danger";
  }
}

async function loadCatalog() {
  const payload = await api("/api/catalog");
  state.catalog = payload.catalog;
  pruneMissingCartItems();
  renderFilters();
  renderCatalog();
  renderCart();
  renderOrder();
}

async function submitCheckout(event) {
  event.preventDefault();
  setMessage("");

  const username = elements.usernameInput.value.trim();
  const orderNumber = elements.orderNumberInput.value.trim();

  if (!usernamePattern.test(username)) {
    setMessage("Enter a valid Minecraft username before creating the order.", "danger");
    return;
  }

  if (state.cart.length === 0) {
    setMessage("Add at least one product to the cart first.", "danger");
    return;
  }

  const payload = {
    username,
    orderNumber,
    items: state.cart.map((item) => ({
      productId: item.productId,
      quantity: item.quantity
    }))
  };

  try {
    const created = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    const checkout = await api("/api/payments/mock/checkout", {
      method: "POST",
      body: JSON.stringify({ orderId: created.order.id })
    });

    state.currentOrder = {
      ...created.order,
      payment: {
        ...created.order.payment,
        reference: checkout.payment.paymentReference
      }
    };

    state.cart = [];
    persistCart();
    persistCurrentOrder();
    renderCart();
    renderOrder();
    setMessage(`Order ${created.order.orderNumber} created. Payment is still pending.`, "success");
  } catch (error) {
    setMessage(error.message, "danger");
  }
}

async function completePayment() {
  if (!state.currentOrder) {
    return;
  }

  setMessage("Processing signed mock payment callback...", "neutral");

  try {
    const payment = await api("/api/payments/mock/complete", {
      method: "POST",
      body: JSON.stringify({ orderId: state.currentOrder.id })
    });

    state.currentOrder = payment.payment.order;
    persistCurrentOrder();
    renderOrder();
    setMessage(`Payment captured for ${state.currentOrder.orderNumber}. The plugin can claim it now.`, "success");
  } catch (error) {
    setMessage(error.message, "danger");
  }
}

function resetOrder() {
  state.currentOrder = null;
  persistCurrentOrder();
  renderOrder();
  setMessage("");
}

async function verifyOrder(event) {
  event.preventDefault();
  const id = elements.verifyOrderInput.value.trim();

  if (!id) {
    setMessage("Enter an order ID or order number to verify status.", "danger");
    return;
  }

  try {
    const payload = await api(`/api/orders/${encodeURIComponent(id)}/verify`);
    setMessage(
      `Order ${payload.verification.orderNumber}: payment ${payload.verification.paymentStatus}, delivery ${payload.verification.deliveryStatus}.`,
      "success"
    );
  } catch (error) {
    setMessage(error.message, "danger");
  }
}

elements.checkoutForm.addEventListener("submit", submitCheckout);
elements.mockPayButton.addEventListener("click", completePayment);
elements.resetOrderButton.addEventListener("click", resetOrder);
elements.verifyForm.addEventListener("submit", verifyOrder);

if (state.currentOrder) {
  elements.usernameInput.value = state.currentOrder.username;
}

loadHealth();
loadCatalog().catch((error) => {
  elements.catalogGrid.innerHTML = `<div class="empty-state">Failed to load catalog: ${escapeHtml(error.message)}</div>`;
});
