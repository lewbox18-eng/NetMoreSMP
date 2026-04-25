const fs = require("fs/promises");
const path = require("path");

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeStore(store) {
  const source = store || {};
  return {
    sequences: {
      order: 0,
      payment: 0,
      ...(source.sequences || {})
    },
    orders: Array.isArray(source.orders) ? source.orders : [],
    logs: Array.isArray(source.logs) ? source.logs : []
  };
}

class Database {
  constructor(filePath) {
    this.filePath = filePath;
    this.ensurePromise = null;
    this.queue = Promise.resolve();
  }

  async ensure() {
    if (!this.ensurePromise) {
      this.ensurePromise = (async () => {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        try {
          await fs.access(this.filePath);
        } catch (error) {
          await fs.writeFile(this.filePath, JSON.stringify(normalizeStore(), null, 2) + "\n", "utf8");
        }
      })();
    }

    return this.ensurePromise;
  }

  async read() {
    await this.ensure();
    const raw = await fs.readFile(this.filePath, "utf8");
    return clone(normalizeStore(JSON.parse(raw)));
  }

  async update(mutator) {
    const operation = async () => {
      const store = await this.read();
      const result = await mutator(store);
      const normalized = normalizeStore(store);
      await fs.writeFile(this.filePath, JSON.stringify(normalized, null, 2) + "\n", "utf8");
      return clone(result);
    };

    this.queue = this.queue.then(operation, operation);
    return this.queue;
  }
}

function createDatabase(filePath) {
  return new Database(filePath);
}

module.exports = {
  createDatabase
};

