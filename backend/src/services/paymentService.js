const { HttpError } = require("../utils/http");
const { createOpaqueId } = require("../utils/ids");
const { createSignature, verifySignature } = require("../utils/signature");

function now() {
  return new Date().toISOString();
}

function matchesIdentifier(order, idOrOrderNumber) {
  return order.id === idOrOrderNumber || order.orderNumber === idOrOrderNumber;
}

function pushLog(store, event, details) {
  store.logs.unshift({
    id: createOpaqueId("log"),
    scope: "payment",
    event,
    details,
    timestamp: now()
  });
  store.logs = store.logs.slice(0, 500);
}

function createPaymentService({ database, orderService, config }) {
  async function startMockCheckout(idOrOrderNumber) {
    if (!idOrOrderNumber) {
      throw new HttpError(400, "orderId is required");
    }

    const order = await database.update((store) => {
      const record = store.orders.find((entry) => matchesIdentifier(entry, idOrOrderNumber));
      if (!record) {
        throw new HttpError(404, "Order not found");
      }

      if (!record.payment.reference) {
        store.sequences.payment += 1;
        record.payment.reference = `MOCK-${String(store.sequences.payment).padStart(6, "0")}`;
        record.updatedAt = now();
        pushLog(store, "mock.checkout.created", {
          orderId: record.id,
          orderNumber: record.orderNumber,
          paymentReference: record.payment.reference
        });
      }

      return {
        id: record.id,
        orderNumber: record.orderNumber,
        amountCents: record.totals.subtotalCents,
        currency: record.totals.currency,
        paymentReference: record.payment.reference,
        paymentStatus: record.payment.status
      };
    });

    return {
      provider: "mock",
      ...order,
      instructions: "Use the mock checkout button to simulate a signed provider callback."
    };
  }

  async function handleMockWebhook(payload, signatureHeader) {
    if (!verifySignature(payload, config.webhookSecret, signatureHeader)) {
      throw new HttpError(401, "Webhook signature verification failed");
    }

    const order = await orderService.markOrderPaid(payload.orderId || payload.orderNumber, {
      paymentReference: payload.paymentReference,
      paidAt: payload.paidAt || now()
    });

    return {
      accepted: true,
      eventId: payload.eventId,
      orderId: order.id,
      orderNumber: order.orderNumber
    };
  }

  async function completeMockPayment(idOrOrderNumber) {
    const checkout = await startMockCheckout(idOrOrderNumber);
    const payload = {
      eventId: createOpaqueId("evt"),
      orderId: checkout.id,
      orderNumber: checkout.orderNumber,
      paymentReference: checkout.paymentReference,
      amountCents: checkout.amountCents,
      status: "paid",
      paidAt: now()
    };
    const signature = createSignature(payload, config.webhookSecret);
    const webhook = await handleMockWebhook(payload, signature);
    const order = await orderService.getOrder(checkout.id);

    return {
      provider: "mock",
      webhook,
      order
    };
  }

  return {
    startMockCheckout,
    handleMockWebhook,
    completeMockPayment
  };
}

module.exports = {
  createPaymentService
};

