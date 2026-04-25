const { HttpError, readJsonBody, sendJson, sendNoContent, getCorsHeaders, getRequestUrl } = require("./utils/http");
const { assertUsername, parseLimit } = require("./utils/validation");

function unauthorized(message) {
  return new HttpError(401, message);
}

function requireToken(req, headerName, expectedValue, message) {
  const providedValue = req.headers[headerName];
  if (!providedValue || providedValue !== expectedValue) {
    throw unauthorized(message);
  }
}

function createRouter({ config, services }) {
  const corsHeaders = getCorsHeaders(config);

  return async function router(req, res) {
    if (req.method === "OPTIONS") {
      sendNoContent(res, 204, corsHeaders);
      return;
    }

    const url = getRequestUrl(req);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const pathParts = pathname.split("/").filter(Boolean).map(decodeURIComponent);

    if (req.method === "GET" && pathname === "/health") {
      sendJson(
        res,
        200,
        {
          ok: true,
          status: "healthy",
          paymentProvider: config.paymentProvider,
          shopUrl: config.shopUrl
        },
        corsHeaders
      );
      return;
    }

    if (req.method === "GET" && pathname === "/api/catalog") {
      const catalog = await services.catalogService.getCatalog();
      sendJson(res, 200, { ok: true, catalog }, corsHeaders);
      return;
    }

    if (req.method === "POST" && pathname === "/api/orders") {
      const body = await readJsonBody(req);
      const order = await services.orderService.createOrder(body, {
        ipAddress: req.socket.remoteAddress || "unknown",
        userAgent: req.headers["user-agent"] || "unknown",
        origin: req.headers.origin || "unknown"
      });
      sendJson(res, 201, { ok: true, order }, corsHeaders);
      return;
    }

    if (req.method === "GET" && pathParts[0] === "api" && pathParts[1] === "orders" && pathParts.length === 3) {
      const order = await services.orderService.getOrder(pathParts[2]);
      sendJson(res, 200, { ok: true, order }, corsHeaders);
      return;
    }

    if (
      req.method === "GET" &&
      pathParts[0] === "api" &&
      pathParts[1] === "orders" &&
      pathParts[3] === "verify"
    ) {
      const verification = await services.orderService.verifyOrder(pathParts[2]);
      sendJson(res, 200, { ok: true, verification }, corsHeaders);
      return;
    }

    if (req.method === "POST" && pathname === "/api/payments/mock/checkout") {
      const body = await readJsonBody(req);
      const payment = await services.paymentService.startMockCheckout(body.orderId);
      sendJson(res, 200, { ok: true, payment }, corsHeaders);
      return;
    }

    if (req.method === "POST" && pathname === "/api/payments/mock/complete") {
      const body = await readJsonBody(req);
      const payment = await services.paymentService.completeMockPayment(body.orderId);
      sendJson(res, 200, { ok: true, payment }, corsHeaders);
      return;
    }

    if (req.method === "POST" && pathname === "/api/webhooks/mock-payment") {
      const body = await readJsonBody(req);
      const signature = req.headers["x-gitshop-signature"];
      const result = await services.paymentService.handleMockWebhook(body, signature);
      sendJson(res, 200, { ok: true, result }, corsHeaders);
      return;
    }

    if (req.method === "GET" && pathname === "/api/plugin/orders/pending") {
      requireToken(req, "x-plugin-token", config.pluginToken, "Missing or invalid plugin token");
      const limit = parseLimit(url.searchParams.get("limit"), 10, 25);
      const orders = await services.orderService.peekPendingOrders(limit);
      sendJson(res, 200, { ok: true, orders, count: orders.length }, corsHeaders);
      return;
    }

    if (req.method === "POST" && pathname === "/api/plugin/orders/claim") {
      requireToken(req, "x-plugin-token", config.pluginToken, "Missing or invalid plugin token");
      const body = await readJsonBody(req);
      const orders = await services.orderService.claimPaidOrders(body.serverId || "default-server", body.limit);
      sendJson(res, 200, { ok: true, orders, count: orders.length }, corsHeaders);
      return;
    }

    if (
      req.method === "POST" &&
      pathParts[0] === "api" &&
      pathParts[1] === "plugin" &&
      pathParts[2] === "orders" &&
      pathParts[4] === "ack"
    ) {
      requireToken(req, "x-plugin-token", config.pluginToken, "Missing or invalid plugin token");
      const body = await readJsonBody(req);
      const order = await services.orderService.acknowledgeOrder(pathParts[3], body);
      sendJson(res, 200, { ok: true, order }, corsHeaders);
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/orders") {
      requireToken(req, "x-admin-key", config.adminKey, "Missing or invalid admin key");
      const orders = await services.orderService.listOrders({
        username: url.searchParams.get("username"),
        paymentStatus: url.searchParams.get("paymentStatus"),
        deliveryStatus: url.searchParams.get("deliveryStatus"),
        limit: url.searchParams.get("limit")
      });
      sendJson(res, 200, { ok: true, orders, count: orders.length }, corsHeaders);
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/orders/confirm") {
      requireToken(req, "x-admin-key", config.adminKey, "Missing or invalid admin key");
      const body = await readJsonBody(req);
      const orderLookup = String(body.orderLookup || body.orderId || body.orderNumber || "").trim();
      const username = assertUsername(body.username || body.playerName);

      if (!orderLookup) {
        throw new HttpError(400, "orderLookup is required");
      }

      const order = await services.orderService.getOrder(orderLookup);
      if (order.username.toLowerCase() !== username.toLowerCase()) {
        throw new HttpError(409, "Player name does not match that order");
      }

      const payment = await services.paymentService.completeMockPayment(orderLookup);
      sendJson(res, 200, { ok: true, payment }, corsHeaders);
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/catalog") {
      requireToken(req, "x-admin-key", config.adminKey, "Missing or invalid admin key");
      const catalog = await services.catalogService.getCatalog();
      sendJson(res, 200, { ok: true, catalog, count: catalog.length }, corsHeaders);
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/catalog") {
      requireToken(req, "x-admin-key", config.adminKey, "Missing or invalid admin key");
      const body = await readJsonBody(req);
      const product = await services.catalogService.createProduct(body);
      sendJson(res, 201, { ok: true, product }, corsHeaders);
      return;
    }

    if (
      req.method === "PUT" &&
      pathParts[0] === "api" &&
      pathParts[1] === "admin" &&
      pathParts[2] === "catalog" &&
      pathParts.length === 4
    ) {
      requireToken(req, "x-admin-key", config.adminKey, "Missing or invalid admin key");
      const body = await readJsonBody(req);
      const product = await services.catalogService.updateProduct(pathParts[3], body);
      sendJson(res, 200, { ok: true, product }, corsHeaders);
      return;
    }

    if (
      req.method === "DELETE" &&
      pathParts[0] === "api" &&
      pathParts[1] === "admin" &&
      pathParts[2] === "catalog" &&
      pathParts.length === 4
    ) {
      requireToken(req, "x-admin-key", config.adminKey, "Missing or invalid admin key");
      const product = await services.catalogService.deleteProduct(pathParts[3]);
      sendJson(res, 200, { ok: true, product }, corsHeaders);
      return;
    }

    if (
      req.method === "POST" &&
      pathParts[0] === "api" &&
      pathParts[1] === "admin" &&
      pathParts[2] === "orders" &&
      pathParts[4] === "resend"
    ) {
      requireToken(req, "x-admin-key", config.adminKey, "Missing or invalid admin key");
      const order = await services.orderService.resendOrder(pathParts[3]);
      sendJson(res, 200, { ok: true, order }, corsHeaders);
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/logs") {
      requireToken(req, "x-admin-key", config.adminKey, "Missing or invalid admin key");
      const limit = parseLimit(url.searchParams.get("limit"), 50, 200);
      const logs = await services.orderService.getLogs(limit);
      sendJson(res, 200, { ok: true, logs, count: logs.length }, corsHeaders);
      return;
    }

    throw new HttpError(404, `Route not found: ${req.method} ${pathname}`);
  };
}

module.exports = {
  createRouter
};
