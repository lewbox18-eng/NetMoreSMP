const http = require("http");
const { config } = require("./config");
const { createDatabase } = require("./store/database");
const { createCatalogService } = require("./services/catalogService");
const { createOrderService } = require("./services/orderService");
const { createPaymentService } = require("./services/paymentService");
const { createRouter } = require("./router");
const { HttpError, sendJson, getCorsHeaders } = require("./utils/http");

async function start() {
  const database = createDatabase(config.dataFile);
  const catalogService = createCatalogService(config.catalogFile);
  const orderService = createOrderService({ database, catalogService, config });
  const paymentService = createPaymentService({ database, orderService, config });
  const router = createRouter({
    config,
    services: {
      catalogService,
      orderService,
      paymentService
    }
  });

  await database.ensure();
  await catalogService.getCatalog();

  const server = http.createServer(async (req, res) => {
    try {
      await router(req, res);
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const message = error instanceof HttpError ? error.message : "Internal server error";
      const details = error instanceof HttpError ? error.details : undefined;

      if (!(error instanceof HttpError)) {
        console.error("[gitshop] unexpected error", error);
      }

      sendJson(
        res,
        statusCode,
        {
          ok: false,
          error: message,
          details
        },
        getCorsHeaders(config)
      );
    }
  });

  server.listen(config.port, config.host, () => {
    console.log(`[gitshop] api listening on http://${config.host}:${config.port}`);
  });
}

start().catch((error) => {
  console.error("[gitshop] failed to start", error);
  process.exitCode = 1;
});

