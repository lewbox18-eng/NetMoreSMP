const { HttpError } = require("../utils/http");
const { assertUsername, normalizeOrderNumber, normalizeCartItems, parseLimit } = require("../utils/validation");
const { createOpaqueId, createOrderNumber, createClaimToken } = require("../utils/ids");

function now() {
  return new Date().toISOString();
}

function matchesIdentifier(order, idOrOrderNumber) {
  return order.id === idOrOrderNumber || order.orderNumber === idOrOrderNumber;
}

function isClaimExpired(order, claimTtlMs) {
  if (order.delivery.status !== "claimed" || !order.delivery.claimedAt) {
    return false;
  }
  return Date.now() - Date.parse(order.delivery.claimedAt) > claimTtlMs;
}

function pushLog(store, scope, event, details) {
  store.logs.unshift({
    id: createOpaqueId("log"),
    scope,
    event,
    details,
    timestamp: now()
  });
  store.logs = store.logs.slice(0, 500);
}

function publicLineItem(item) {
  return {
    productId: item.productId,
    name: item.name,
    description: item.description,
    category: item.category,
    quantity: item.quantity,
    priceCents: item.priceCents,
    icon: item.icon,
    accent: item.accent,
    imageUrl: item.imageUrl
  };
}

function pluginLineItem(item) {
  return {
    ...publicLineItem(item),
    iconMaterial: item.iconMaterial,
    rewardKey: item.rewardKey
  };
}

function toShopOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    username: order.username,
    lineItems: order.lineItems.map(publicLineItem),
    totals: order.totals,
    payment: order.payment,
    delivery: {
      status: order.delivery.status,
      claimedBy: order.delivery.claimedBy,
      deliveredAt: order.delivery.deliveredAt,
      failureReason: order.delivery.failureReason,
      retryCount: order.delivery.retryCount
    },
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

function toAdminOrder(order) {
  return {
    ...toShopOrder(order),
    source: order.source,
    receipt: order.delivery.receipt
  };
}

function toPluginOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    username: order.username,
    claimToken: order.delivery.claimToken,
    lineItems: order.lineItems.map(pluginLineItem),
    totals: order.totals,
    createdAt: order.createdAt
  };
}

function createOrderService({ database, catalogService, config }) {
  async function createOrder(payload, requestContext) {
    const username = assertUsername(payload.username);
    const orderNumberCandidate = normalizeOrderNumber(payload.orderNumber);
    const cartItems = normalizeCartItems(payload.items);
    const catalogMap = await catalogService.getCatalogMap();

    const lineItems = cartItems.map(({ productId, quantity }) => {
      const product = catalogMap.get(productId);
      if (!product) {
        throw new HttpError(400, `Unknown product: ${productId}`);
      }

      return {
        productId: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        quantity,
        priceCents: product.priceCents,
        icon: product.icon,
        accent: product.accent,
        imageUrl: product.imageUrl,
        iconMaterial: product.iconMaterial,
        rewardKey: product.rewardKey
      };
    });

    const itemCount = lineItems.reduce((sum, item) => sum + item.quantity, 0);
    const subtotalCents = lineItems.reduce((sum, item) => sum + item.quantity * item.priceCents, 0);

    return database.update((store) => {
      if (orderNumberCandidate && store.orders.some((order) => order.orderNumber === orderNumberCandidate)) {
        throw new HttpError(409, "Order number already exists");
      }

      store.sequences.order += 1;
      const timestamp = now();
      const order = {
        id: createOpaqueId("ord"),
        orderNumber: orderNumberCandidate || createOrderNumber(config.orderPrefix, store.sequences.order),
        username,
        usernameNormalized: username.toLowerCase(),
        lineItems,
        totals: {
          currency: "USD",
          itemCount,
          subtotalCents
        },
        payment: {
          provider: config.paymentProvider,
          status: "pending",
          reference: null,
          paidAt: null
        },
        delivery: {
          status: "pending",
          claimedBy: null,
          claimToken: null,
          claimedAt: null,
          deliveredAt: null,
          failureReason: null,
          retryCount: 0,
          receipt: null
        },
        source: {
          ipAddress: requestContext.ipAddress,
          userAgent: requestContext.userAgent,
          origin: requestContext.origin
        },
        createdAt: timestamp,
        updatedAt: timestamp
      };

      store.orders.unshift(order);
      pushLog(store, "order", "created", {
        orderId: order.id,
        orderNumber: order.orderNumber,
        username: order.username,
        itemCount: order.totals.itemCount
      });

      return toShopOrder(order);
    });
  }

  async function getOrder(idOrOrderNumber) {
    const store = await database.read();
    const order = store.orders.find((entry) => matchesIdentifier(entry, idOrOrderNumber));
    if (!order) {
      throw new HttpError(404, "Order not found");
    }
    return toShopOrder(order);
  }

  async function verifyOrder(idOrOrderNumber) {
    const order = await getOrder(idOrOrderNumber);
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      username: order.username,
      paymentStatus: order.payment.status,
      deliveryStatus: order.delivery.status,
      totals: order.totals,
      updatedAt: order.updatedAt
    };
  }

  async function markOrderPaid(idOrOrderNumber, paymentUpdate) {
    return database.update((store) => {
      const order = store.orders.find((entry) => matchesIdentifier(entry, idOrOrderNumber));
      if (!order) {
        throw new HttpError(404, "Order not found");
      }

      if (order.payment.status !== "paid") {
        order.payment.status = "paid";
        order.payment.reference = paymentUpdate.paymentReference || order.payment.reference;
        order.payment.paidAt = paymentUpdate.paidAt || now();
        order.updatedAt = now();
        pushLog(store, "payment", "paid", {
          orderId: order.id,
          orderNumber: order.orderNumber,
          paymentReference: order.payment.reference
        });
      }

      return toShopOrder(order);
    });
  }

  async function peekPendingOrders(limitValue) {
    const store = await database.read();
    const limit = parseLimit(limitValue, 10, 25);
    return store.orders
      .filter((order) => order.payment.status === "paid" && order.delivery.status === "pending")
      .slice(0, limit)
      .map(toPluginOrder);
  }

  async function claimPaidOrders(serverId, limitValue) {
    const limit = parseLimit(limitValue, 10, 25);

    return database.update((store) => {
      const claimedOrders = [];
      const timestamp = now();

      for (const order of store.orders) {
        const claimExpired = isClaimExpired(order, config.claimTtlMs);
        const eligible = order.payment.status === "paid" && (order.delivery.status === "pending" || claimExpired);

        if (!eligible) {
          continue;
        }

        order.delivery.status = "claimed";
        order.delivery.claimedBy = serverId;
        order.delivery.claimedAt = timestamp;
        order.delivery.claimToken = createClaimToken();
        order.updatedAt = timestamp;

        pushLog(store, "plugin", "claimed", {
          orderId: order.id,
          orderNumber: order.orderNumber,
          serverId
        });

        claimedOrders.push(toPluginOrder(order));

        if (claimedOrders.length >= limit) {
          break;
        }
      }

      return claimedOrders;
    });
  }

  async function acknowledgeOrder(idOrOrderNumber, payload) {
    const success = Boolean(payload.success);
    const claimToken = String(payload.claimToken || "");

    if (!claimToken) {
      throw new HttpError(400, "claimToken is required");
    }

    return database.update((store) => {
      const order = store.orders.find((entry) => matchesIdentifier(entry, idOrOrderNumber));
      if (!order) {
        throw new HttpError(404, "Order not found");
      }

      if (order.delivery.claimToken !== claimToken) {
        throw new HttpError(409, "Claim token mismatch");
      }

      order.updatedAt = now();
      order.delivery.claimToken = null;
      order.delivery.claimedAt = null;
      order.delivery.claimedBy = null;

      if (success) {
        order.delivery.status = "delivered";
        order.delivery.deliveredAt = order.updatedAt;
        order.delivery.failureReason = null;
        order.delivery.receipt = {
          deliveredItems: Array.isArray(payload.deliveredItems) ? payload.deliveredItems : [],
          notes: payload.notes ? String(payload.notes) : ""
        };

        pushLog(store, "plugin", "delivered", {
          orderId: order.id,
          orderNumber: order.orderNumber
        });
      } else {
        order.delivery.status = "failed";
        order.delivery.retryCount += 1;
        order.delivery.failureReason = payload.failureReason
          ? String(payload.failureReason)
          : "Plugin delivery failed";
        pushLog(store, "plugin", "failed", {
          orderId: order.id,
          orderNumber: order.orderNumber,
          failureReason: order.delivery.failureReason
        });
      }

      return toShopOrder(order);
    });
  }

  async function listOrders(filters = {}) {
    const store = await database.read();
    const limit = parseLimit(filters.limit, 50, 250);
    const usernameFilter = filters.username ? String(filters.username).trim().toLowerCase() : null;

    return store.orders
      .filter((order) => {
        if (usernameFilter && !order.usernameNormalized.includes(usernameFilter)) {
          return false;
        }
        if (filters.paymentStatus && order.payment.status !== filters.paymentStatus) {
          return false;
        }
        if (filters.deliveryStatus && order.delivery.status !== filters.deliveryStatus) {
          return false;
        }
        return true;
      })
      .slice(0, limit)
      .map(toAdminOrder);
  }

  async function resendOrder(idOrOrderNumber) {
    return database.update((store) => {
      const order = store.orders.find((entry) => matchesIdentifier(entry, idOrOrderNumber));
      if (!order) {
        throw new HttpError(404, "Order not found");
      }

      if (order.payment.status !== "paid") {
        throw new HttpError(409, "Only paid orders can be resent");
      }

      if (order.delivery.status !== "failed") {
        throw new HttpError(409, "Only failed orders can be resent");
      }

      order.delivery.status = "pending";
      order.delivery.failureReason = null;
      order.delivery.claimToken = null;
      order.delivery.claimedAt = null;
      order.delivery.claimedBy = null;
      order.delivery.receipt = null;
      order.updatedAt = now();

      pushLog(store, "admin", "resent", {
        orderId: order.id,
        orderNumber: order.orderNumber
      });

      return toShopOrder(order);
    });
  }

  async function getLogs(limitValue) {
    const store = await database.read();
    const limit = parseLimit(limitValue, 50, 200);
    return store.logs.slice(0, limit);
  }

  return {
    createOrder,
    getOrder,
    verifyOrder,
    markOrderPaid,
    peekPendingOrders,
    claimPaidOrders,
    acknowledgeOrder,
    listOrders,
    resendOrder,
    getLogs
  };
}

module.exports = {
  createOrderService
};
