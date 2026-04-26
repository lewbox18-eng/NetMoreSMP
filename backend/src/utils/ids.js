const crypto = require("crypto");

function createOpaqueId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function createOrderNumber(prefix, sequence, now = new Date()) {
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const serial = String(sequence).padStart(5, "0");
  return `${prefix}-${datePart}-${serial}`;
}

function createClaimToken() {
  return crypto.randomBytes(18).toString("hex");
}

module.exports = {
  createOpaqueId,
  createOrderNumber,
  createClaimToken
};

