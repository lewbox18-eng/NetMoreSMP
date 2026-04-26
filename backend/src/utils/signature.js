const crypto = require("crypto");

function stableStringify(payload) {
  if (Array.isArray(payload)) {
    return `[${payload.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (payload && typeof payload === "object") {
    const keys = Object.keys(payload).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(payload[key])}`).join(",")}}`;
  }

  return JSON.stringify(payload);
}

function normalizePayload(payload) {
  return typeof payload === "string" ? payload : stableStringify(payload);
}

function createSignature(payload, secret) {
  const body = normalizePayload(payload);
  const hash = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hash}`;
}

function verifySignature(payload, secret, providedSignature) {
  if (!providedSignature) {
    return false;
  }

  const expected = createSignature(payload, secret);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(providedSignature);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

module.exports = {
  createSignature,
  verifySignature
};

