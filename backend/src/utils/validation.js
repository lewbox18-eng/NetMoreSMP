const { HttpError } = require("./http");

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const ORDER_NUMBER_PATTERN = /^[A-Z0-9_-]{6,32}$/;
const PRODUCT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const MATERIAL_PATTERN = /^[A-Z0-9_]{2,40}$/;
const REWARD_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertUsername(value) {
  const username = String(value || "").trim();
  if (!USERNAME_PATTERN.test(username)) {
    throw new HttpError(
      400,
      "Username must be 3-16 characters and contain only letters, numbers, or underscores"
    );
  }
  return username;
}

function normalizeOrderNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const orderNumber = String(value).trim().toUpperCase();
  if (!ORDER_NUMBER_PATTERN.test(orderNumber)) {
    throw new HttpError(400, "Order number must be 6-32 characters using A-Z, 0-9, underscore, or hyphen");
  }

  return orderNumber;
}

function normalizeCartItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, "At least one catalog item is required");
  }

  const merged = new Map();

  for (const item of items) {
    const productId = String(item && item.productId ? item.productId : "").trim();
    const quantity = Number.parseInt(item && item.quantity ? item.quantity : 1, 10);

    if (!productId) {
      throw new HttpError(400, "Each cart item must include a productId");
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      throw new HttpError(400, "Each cart item quantity must be between 1 and 10");
    }

    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }

  return Array.from(merged.entries()).map(([productId, quantity]) => ({ productId, quantity }));
}

function parseLimit(value, fallback = 10, max = 50) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function requireString(value, label, { min = 1, max = 120 } = {}) {
  const normalized = String(value || "").trim();
  if (normalized.length < min || normalized.length > max) {
    throw new HttpError(400, `${label} must be between ${min} and ${max} characters`);
  }
  return normalized;
}

function normalizeCatalogProductId(value) {
  const productId = String(value || "").trim().toLowerCase();
  if (productId.length < 3 || productId.length > 40 || !PRODUCT_ID_PATTERN.test(productId)) {
    throw new HttpError(
      400,
      "Product id must be 3-40 characters using lowercase letters, numbers, and hyphens"
    );
  }
  return productId;
}

function normalizeCatalogImageUrl(value) {
  const imageUrl = String(value || "").trim();
  if (!imageUrl) {
    return "";
  }

  if (imageUrl.startsWith("./") || imageUrl.startsWith("../") || imageUrl.startsWith("/")) {
    return imageUrl;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(imageUrl);
  } catch (error) {
    throw new HttpError(400, "Image URL must be an http(s) URL or a relative asset path");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new HttpError(400, "Image URL must use http or https");
  }

  return parsedUrl.toString();
}

function normalizeRewardKey(value) {
  const rewardKey = String(value || "").trim().toLowerCase();
  if (!rewardKey || !REWARD_KEY_PATTERN.test(rewardKey) || rewardKey.length > 40) {
    throw new HttpError(400, "Reward key must use lowercase letters, numbers, and hyphens");
  }
  return rewardKey;
}

function normalizeCatalogProduct(payload, { existingId } = {}) {
  const id = existingId || normalizeCatalogProductId(payload.id);
  const name = requireString(payload.name, "Product name", { min: 2, max: 80 });
  const description = requireString(payload.description, "Product description", { min: 8, max: 400 });
  const category = requireString(payload.category, "Category", { min: 2, max: 40 });
  const priceCents = Number.parseInt(payload.priceCents, 10);
  const icon = String(payload.icon || "").trim().slice(0, 8);
  const accent = String(payload.accent || "#1f7a8c").trim();
  const iconMaterial = String(payload.iconMaterial || "CHEST").trim().toUpperCase();
  const imageUrl = normalizeCatalogImageUrl(payload.imageUrl);
  const rewardKey = normalizeRewardKey(payload.rewardKey);

  if (!Number.isInteger(priceCents) || priceCents < 1 || priceCents > 10000000) {
    throw new HttpError(400, "Price must be a whole number of cents between 1 and 10000000");
  }

  if (!HEX_COLOR_PATTERN.test(accent)) {
    throw new HttpError(400, "Accent color must be a hex value like #d95b37");
  }

  if (!MATERIAL_PATTERN.test(iconMaterial)) {
    throw new HttpError(400, "Icon material must use Minecraft-style uppercase values like DIAMOND");
  }

  return {
    id,
    name,
    description,
    category,
    priceCents,
    icon,
    accent,
    imageUrl,
    iconMaterial,
    rewardKey
  };
}

module.exports = {
  assertUsername,
  normalizeOrderNumber,
  normalizeCartItems,
  parseLimit,
  normalizeCatalogProduct,
  normalizeCatalogProductId
};
