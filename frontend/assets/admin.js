const config = window.GitShopConfig || {};

const state = {
  adminKey: sessionStorage.getItem("gitshop.adminKey") || "",
  catalog: []
};

const elements = {
  adminConnectForm: document.querySelector("#adminConnectForm"),
  adminKeyInput: document.querySelector("#adminKeyInput"),
  adminStatus: document.querySelector("#adminStatus"),
  adminFiltersForm: document.querySelector("#adminFiltersForm"),
  paymentStatusFilter: document.querySelector("#paymentStatusFilter"),
  deliveryStatusFilter: document.querySelector("#deliveryStatusFilter"),
  usernameFilter: document.querySelector("#usernameFilter"),
  orderConfirmForm: document.querySelector("#orderConfirmForm"),
  orderConfirmInput: document.querySelector("#orderConfirmInput"),
  orderConfirmPlayerInput: document.querySelector("#orderConfirmPlayerInput"),
  catalogCount: document.querySelector("#catalogCount"),
  catalogCreateForm: document.querySelector("#catalogCreateForm"),
  catalogGrid: document.querySelector("#catalogGrid"),
  ordersTable: document.querySelector("#ordersTable"),
  logsPanel: document.querySelector("#logsPanel")
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

function setStatus(text, tone) {
  elements.adminStatus.textContent = text;
  elements.adminStatus.dataset.tone = tone;
}

async function adminApi(path, options = {}) {
  if (!state.adminKey) {
    throw new Error("Enter the admin key first.");
  }

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": state.adminKey,
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({
    ok: false,
    error: "Invalid response from backend"
  }));

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Admin request failed");
  }

  return payload;
}

function formatMoney(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: config.currency || "USD"
  }).format((cents || 0) / 100);
}

function formatPriceInput(cents) {
  return ((cents || 0) / 100).toFixed(2);
}

function buildOrderQuery() {
  const query = new URLSearchParams();

  if (elements.paymentStatusFilter.value) {
    query.set("paymentStatus", elements.paymentStatusFilter.value);
  }

  if (elements.deliveryStatusFilter.value) {
    query.set("deliveryStatus", elements.deliveryStatusFilter.value);
  }

  if (elements.usernameFilter.value.trim()) {
    query.set("username", elements.usernameFilter.value.trim());
  }

  query.set("limit", "100");
  return query.toString();
}

function buildCatalogFields(product, { includeId }) {
  const preview = product.imageUrl
    ? `<img class="catalog-preview-image" src="${escapeAttribute(product.imageUrl)}" alt="${escapeAttribute(product.name || product.id || "Catalog item")}">`
    : `<div class="catalog-preview-fallback">${escapeHtml(product.icon || (product.name || "NM").slice(0, 2).toUpperCase())}</div>`;

  return `
    ${includeId ? `
      <label>
        <span>Item id</span>
        <input type="text" name="id" value="${escapeAttribute(product.id || "")}" placeholder="netmore-vip">
      </label>
    ` : `
      <div class="catalog-static-field">
        <span>Item id</span>
        <strong>${escapeHtml(product.id)}</strong>
      </div>
    `}

    <div class="catalog-form-row">
      <label>
        <span>Name</span>
        <input type="text" name="name" value="${escapeAttribute(product.name || "")}" placeholder="VIP Rank">
      </label>

      <label>
        <span>Category</span>
        <input type="text" name="category" value="${escapeAttribute(product.category || "")}" placeholder="Ranks">
      </label>

      <label>
        <span>Price (USD)</span>
        <input type="number" name="priceDollars" min="0.01" step="0.01" value="${escapeAttribute(formatPriceInput(product.priceCents || 0))}" placeholder="9.99">
      </label>
    </div>

    <label>
      <span>Description</span>
      <textarea name="description" rows="4" placeholder="Describe what the player receives.">${escapeHtml(product.description || "")}</textarea>
    </label>

    <div class="catalog-form-row catalog-media-row">
      <label>
        <span>Image URL or asset path</span>
        <input type="text" name="imageUrl" value="${escapeAttribute(product.imageUrl || "")}" placeholder="./assets/products/vip-rank.svg">
      </label>

      <div class="catalog-preview">
        ${preview}
      </div>
    </div>

    <div class="catalog-form-row">
      <label>
        <span>Fallback icon</span>
        <input type="text" name="icon" maxlength="8" value="${escapeAttribute(product.icon || "")}" placeholder="VIP">
      </label>

      <label>
        <span>Accent</span>
        <input type="text" name="accent" value="${escapeAttribute(product.accent || "#1f7a8c")}" placeholder="#d95b37">
      </label>

      <label>
        <span>Icon material</span>
        <input type="text" name="iconMaterial" value="${escapeAttribute(product.iconMaterial || "CHEST")}" placeholder="DIAMOND">
      </label>
    </div>

    <label>
      <span>Reward key</span>
      <input type="text" name="rewardKey" value="${escapeAttribute(product.rewardKey || "")}" placeholder="netmore-key">
    </label>
  `;
}

function createBlankProduct() {
  return {
    id: "",
    name: "",
    category: "",
    description: "",
    priceCents: 999,
    imageUrl: "",
    icon: "",
    accent: "#d95b37",
    iconMaterial: "CHEST",
    rewardKey: ""
  };
}

function parseProductForm(form, { includeId }) {
  const formData = new FormData(form);
  const priceText = String(formData.get("priceDollars") || "").trim();
  const priceNumber = Number.parseFloat(priceText);

  if (!Number.isFinite(priceNumber) || priceNumber <= 0) {
    throw new Error("Price must be a valid number greater than zero.");
  }

  return {
    ...(includeId ? { id: String(formData.get("id") || "").trim().toLowerCase() } : {}),
    name: String(formData.get("name") || "").trim(),
    category: String(formData.get("category") || "").trim(),
    description: String(formData.get("description") || "").trim(),
    priceCents: Math.round(priceNumber * 100),
    imageUrl: String(formData.get("imageUrl") || "").trim(),
    icon: String(formData.get("icon") || "").trim(),
    accent: String(formData.get("accent") || "").trim(),
    iconMaterial: String(formData.get("iconMaterial") || "").trim(),
    rewardKey: String(formData.get("rewardKey") || "").trim().toLowerCase()
  };
}

function renderCatalogCreateForm() {
  elements.catalogCreateForm.innerHTML = `
    ${buildCatalogFields(createBlankProduct(), { includeId: true })}
    <div class="catalog-actions">
      <button class="button" type="submit">Create item</button>
    </div>
  `;
}

function renderCatalogEditor() {
  elements.catalogCount.textContent = `${state.catalog.length} item${state.catalog.length === 1 ? "" : "s"}`;

  if (!state.catalog.length) {
    elements.catalogGrid.innerHTML = `<div class="empty-state">No catalog items yet. Use the form on the left to add the first one.</div>`;
    return;
  }

  elements.catalogGrid.innerHTML = state.catalog
    .map((product) => {
      return `
        <article class="catalog-editor-card">
          <div class="catalog-card-header">
            <div>
              <p class="eyebrow">Editable item</p>
              <h3>${escapeHtml(product.name)}</h3>
            </div>
            <span class="catalog-id-pill">${escapeHtml(product.id)}</span>
          </div>

          <form class="catalog-form" data-product-id="${escapeAttribute(product.id)}">
            ${buildCatalogFields(product, { includeId: false })}
            <div class="catalog-actions">
              <button class="button" type="submit">Save changes</button>
              <button class="button ghost-button" type="button" data-delete-product="${escapeAttribute(product.id)}">Delete item</button>
            </div>
          </form>
        </article>
      `;
    })
    .join("");

  elements.catalogGrid.querySelectorAll("form[data-product-id]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      try {
        const productId = form.dataset.productId;
        const payload = parseProductForm(form, { includeId: false });
        await adminApi(`/api/admin/catalog/${encodeURIComponent(productId)}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        await refreshAdminData("Catalog item updated.");
      } catch (error) {
        setStatus(error.message, "danger");
      }
    });
  });

  elements.catalogGrid.querySelectorAll("[data-delete-product]").forEach((button) => {
    button.addEventListener("click", async () => {
      const productId = button.dataset.deleteProduct;
      const approved = window.confirm(`Delete ${productId} from the shop catalog?`);
      if (!approved) {
        return;
      }

      try {
        await adminApi(`/api/admin/catalog/${encodeURIComponent(productId)}`, {
          method: "DELETE"
        });
        await refreshAdminData("Catalog item deleted.");
      } catch (error) {
        setStatus(error.message, "danger");
      }
    });
  });
}

function renderOrders(orders) {
  if (!orders.length) {
    elements.ordersTable.innerHTML = `<div class="empty-state">No orders match the current filters.</div>`;
    return;
  }

  elements.ordersTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Order</th>
          <th>Player</th>
          <th>Total</th>
          <th>Payment</th>
          <th>Delivery</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${orders
          .map((order) => {
            const canResend = order.delivery.status === "failed";
            return `
              <tr>
                <td>
                  <strong>${escapeHtml(order.orderNumber)}</strong>
                  <p>${escapeHtml(order.id)}</p>
                </td>
                <td>${escapeHtml(order.username)}</td>
                <td>${formatMoney(order.totals.subtotalCents)}</td>
                <td>${escapeHtml(order.payment.status)}</td>
                <td>${escapeHtml(order.delivery.status)}</td>
                <td>
                  ${
                    canResend
                      ? `<button class="button ghost-button" type="button" data-resend="${escapeAttribute(order.id)}">Resend</button>`
                      : `<span class="muted-label">No action</span>`
                  }
                </td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;

  elements.ordersTable.querySelectorAll("[data-resend]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await adminApi(`/api/admin/orders/${encodeURIComponent(button.dataset.resend)}/resend`, {
          method: "POST"
        });
        await refreshAdminData("Order moved back to pending delivery.");
      } catch (error) {
        setStatus(error.message, "danger");
      }
    });
  });
}

function renderLogs(logs) {
  if (!logs.length) {
    elements.logsPanel.innerHTML = `<div class="empty-state">No backend logs yet.</div>`;
    return;
  }

  elements.logsPanel.innerHTML = logs
    .map((log) => {
      return `
        <div class="log-entry">
          <strong>${escapeHtml(`${log.scope}.${log.event}`)}</strong>
          <pre>${escapeHtml(JSON.stringify(log.details, null, 2))}</pre>
          <span>${escapeHtml(new Date(log.timestamp).toLocaleString())}</span>
        </div>
      `;
    })
    .join("");
}

async function refreshAdminData(successMessage) {
  const orderQuery = buildOrderQuery();
  const [catalog, orders, logs] = await Promise.all([
    adminApi("/api/admin/catalog"),
    adminApi(`/api/admin/orders?${orderQuery}`),
    adminApi("/api/admin/logs?limit=40")
  ]);

  state.catalog = catalog.catalog;
  renderCatalogCreateForm();
  renderCatalogEditor();
  renderOrders(orders.orders);
  renderLogs(logs.logs);
  setStatus(successMessage || "Connected", "success");
}

elements.adminConnectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.adminKey = elements.adminKeyInput.value.trim();
  sessionStorage.setItem("gitshop.adminKey", state.adminKey);

  try {
    await refreshAdminData();
  } catch (error) {
    setStatus(error.message, "danger");
  }
});

elements.adminFiltersForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await refreshAdminData("Filters updated.");
  } catch (error) {
    setStatus(error.message, "danger");
  }
});

elements.orderConfirmForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const orderLookup = elements.orderConfirmInput.value.trim();
    const username = elements.orderConfirmPlayerInput.value.trim();
    if (!orderLookup) {
      throw new Error("Enter an order number first.");
    }
    if (!username) {
      throw new Error("Enter the player name too.");
    }

    const result = await adminApi("/api/admin/orders/confirm", {
      method: "POST",
      body: JSON.stringify({ orderLookup, username })
    });

    elements.orderConfirmInput.value = "";
    elements.orderConfirmPlayerInput.value = "";
    await refreshAdminData(`Order ${result.payment.order.orderNumber} confirmed.`);
  } catch (error) {
    setStatus(error.message, "danger");
  }
});

elements.catalogCreateForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const payload = parseProductForm(elements.catalogCreateForm, { includeId: true });
    await adminApi("/api/admin/catalog", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await refreshAdminData("Catalog item created.");
  } catch (error) {
    setStatus(error.message, "danger");
  }
});

elements.adminKeyInput.value = state.adminKey;
renderCatalogCreateForm();

if (state.adminKey) {
  refreshAdminData().catch((error) => {
    setStatus(error.message, "danger");
  });
}
