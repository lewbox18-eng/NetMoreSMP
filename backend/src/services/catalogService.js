const fs = require("fs/promises");
const { HttpError } = require("../utils/http");
const { normalizeCatalogProduct, normalizeCatalogProductId } = require("../utils/validation");

function normalizeProduct(product) {
  return {
    id: String(product.id),
    name: String(product.name),
    description: String(product.description),
    category: String(product.category || "General"),
    priceCents: Number.parseInt(product.priceCents, 10),
    icon: product.icon ? String(product.icon) : "",
    accent: product.accent ? String(product.accent) : "#1f7a8c",
    imageUrl: product.imageUrl ? String(product.imageUrl) : "",
    iconMaterial: product.iconMaterial ? String(product.iconMaterial) : "CHEST",
    rewardKey: product.rewardKey ? String(product.rewardKey) : ""
  };
}

function createCatalogService(catalogFile) {
  async function readCatalogFile() {
    const raw = await fs.readFile(catalogFile, "utf8");
    const catalog = JSON.parse(raw);
    if (!Array.isArray(catalog)) {
      throw new HttpError(500, "Catalog file is invalid");
    }
    return catalog.map(normalizeProduct);
  }

  async function writeCatalogFile(catalog) {
    await fs.writeFile(catalogFile, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  }

  async function getCatalog() {
    return readCatalogFile();
  }

  async function getCatalogMap() {
    const catalog = await getCatalog();
    return new Map(catalog.map((product) => [product.id, product]));
  }

  async function createProduct(payload) {
    const catalog = await readCatalogFile();
    const product = normalizeCatalogProduct(payload);

    if (catalog.some((entry) => entry.id === product.id)) {
      throw new HttpError(409, `A product with id ${product.id} already exists`);
    }

    catalog.push(product);
    await writeCatalogFile(catalog);
    return product;
  }

  async function updateProduct(productId, payload) {
    const normalizedId = normalizeCatalogProductId(productId);
    const catalog = await readCatalogFile();
    const index = catalog.findIndex((entry) => entry.id === normalizedId);

    if (index === -1) {
      throw new HttpError(404, "Catalog item not found");
    }

    const nextProduct = normalizeCatalogProduct(
      {
        ...catalog[index],
        ...payload,
        id: normalizedId
      },
      { existingId: normalizedId }
    );

    catalog[index] = nextProduct;
    await writeCatalogFile(catalog);
    return nextProduct;
  }

  async function deleteProduct(productId) {
    const normalizedId = normalizeCatalogProductId(productId);
    const catalog = await readCatalogFile();
    const index = catalog.findIndex((entry) => entry.id === normalizedId);

    if (index === -1) {
      throw new HttpError(404, "Catalog item not found");
    }

    const [removedProduct] = catalog.splice(index, 1);
    await writeCatalogFile(catalog);
    return removedProduct;
  }

  return {
    getCatalog,
    getCatalogMap,
    createProduct,
    updateProduct,
    deleteProduct
  };
}

module.exports = {
  createCatalogService
};
