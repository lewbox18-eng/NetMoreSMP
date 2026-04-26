const { URL } = require("url");

class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function getRequestUrl(req) {
  return new URL(req.url, `http://${req.headers.host || "localhost"}`);
}

async function readJsonBody(req, { maxBytes = 1024 * 1024 } = {}) {
  const rawBody = await readRawBody(req, { maxBytes });

  if (rawBody.length === 0) {
    return {};
  }

  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    throw new HttpError(400, "Invalid JSON body");
  }
}

async function readRawBody(req, { maxBytes = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new HttpError(413, "Request body is too large"));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(Buffer.alloc(0));
        return;
      }

      resolve(Buffer.concat(chunks));
    });

    req.on("error", (error) => reject(error));
  });
}

function sendJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

function sendNoContent(res, statusCode = 204, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end();
}

function getCorsHeaders(config) {
  return {
    "Access-Control-Allow-Origin": config.frontendOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key, X-Plugin-Token, X-Gitshop-Signature"
  };
}

module.exports = {
  HttpError,
  getRequestUrl,
  readJsonBody,
  readRawBody,
  sendJson,
  sendNoContent,
  getCorsHeaders
};
