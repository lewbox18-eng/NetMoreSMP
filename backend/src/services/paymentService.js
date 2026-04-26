const { HttpError } = require("../utils/http");
const { createOpaqueId } = require("../utils/ids");
const { createSignature, verifySignature } = require("../utils/signature");
const Stripe = require("stripe");

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
  const stripeClient = config.paymentProvider === "stripe"
    ? new Stripe(config.stripeSecretKey, {
        apiVersion: "2025-03-31.basil"
      })
    : null;

  if (config.paymentProvider === "stripe" && !config.stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe");
  }

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

  async function startStripeCheckout(idOrOrderNumber) {
    if (!stripeClient) {
      throw new HttpError(503, "Stripe payments are not configured");
    }

    const order = await orderService.getOrder(idOrOrderNumber);
    const lineItems = order.lineItems.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: order.totals.currency.toLowerCase(),
        unit_amount: item.priceCents,
        product_data: {
          name: item.name,
          description: item.description
        }
      }
    }));

    const successUrl = new URL(config.shopUrl);
    successUrl.searchParams.set("order", order.id);
    successUrl.searchParams.set("checkout", "success");

    const cancelUrl = new URL(config.shopUrl);
    cancelUrl.searchParams.set("order", order.id);
    cancelUrl.searchParams.set("checkout", "cancel");

    const session = await stripeClient.checkout.sessions.create({
      mode: "payment",
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString(),
      line_items: lineItems,
      client_reference_id: order.id,
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        username: order.username
      }
    });

    return {
      provider: "stripe",
      checkoutUrl: session.url,
      sessionId: session.id,
      paymentReference: session.payment_intent || session.id,
      order
    };
  }

  async function startCheckout(idOrOrderNumber) {
    if (config.paymentProvider === "stripe") {
      return startStripeCheckout(idOrOrderNumber);
    }
    return startMockCheckout(idOrOrderNumber);
  }

  async function handleStripeWebhook(rawBody, signatureHeader) {
    if (!stripeClient || !config.stripeWebhookSecret) {
      throw new HttpError(503, "Stripe webhook is not configured");
    }

    let event;
    try {
      event = stripeClient.webhooks.constructEvent(rawBody, signatureHeader, config.stripeWebhookSecret);
    } catch (error) {
      throw new HttpError(401, "Stripe webhook signature verification failed");
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.payment_status === "paid") {
        const order = await orderService.markOrderPaid(session.metadata.orderId || session.client_reference_id, {
          paymentReference: session.payment_intent || session.id,
          paidAt: now()
        });

        return {
          accepted: true,
          provider: "stripe",
          eventId: event.id,
          orderId: order.id,
          orderNumber: order.orderNumber
        };
      }
    }

    return {
      accepted: true,
      provider: "stripe",
      eventId: event.id,
      ignored: true,
      eventType: event.type
    };
  }

  return {
    startCheckout,
    startMockCheckout,
    handleMockWebhook,
    completeMockPayment,
    handleStripeWebhook
  };
}

module.exports = {
  createPaymentService
};
