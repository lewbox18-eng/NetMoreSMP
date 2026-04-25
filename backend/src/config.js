const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && !Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(__dirname, "..", ".env"));

function parseNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const config = {
  host: process.env.HOST || "0.0.0.0",
  port: parseNumber(process.env.PORT, 8787),
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:8080",
  pluginToken: process.env.PLUGIN_TOKEN || "change-plugin-token",
  adminKey: process.env.ADMIN_KEY || "change-admin-key",
  webhookSecret: process.env.WEBHOOK_SECRET || "change-webhook-secret",
  orderPrefix: process.env.ORDER_PREFIX || "ORD",
  claimTtlMs: parseNumber(process.env.CLAIM_TTL_MS, 300000),
  paymentProvider: process.env.PAYMENT_PROVIDER || "mock",
  shopUrl: process.env.SHOP_URL || "https://your-shop.example.com",
  dataFile: process.env.DATA_FILE || path.join(__dirname, "..", "data", "store.json"),
  catalogFile: process.env.CATALOG_FILE || path.join(__dirname, "..", "data", "catalog.json")
};

module.exports = {
  config
};
