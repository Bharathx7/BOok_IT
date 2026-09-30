import { createHmac, randomBytes } from "node:crypto";

import {
  GatewayError,
  hmacMatches,
  type GatewayPayment,
  type GatewayRefund,
  type PaymentGateway,
} from "./types.js";

// A stand-in gateway for development and tests: no network, no money. It
// signs checkout results and webhooks exactly like Razorpay does, so the
// real verification code runs. State lives in memory (a restart forgets
// unpaid orders, which then simply expire), so run a single API process with
// it: another process picking up a refund job won't know the payment and
// marks the refund failed. Refused in production (env.ts).

export const FAKE_KEY_SECRET = "fake_key_secret";
export const FAKE_WEBHOOK_SECRET = "fake_webhook_secret";

const id = (prefix: string) => `${prefix}_fake${randomBytes(7).toString("hex")}`;

interface Order {
  id: string;
  amountPaise: number;
}

const orders = new Map<string, Order>();
const payments = new Map<string, GatewayPayment>();
const refunds = new Map<string, GatewayRefund[]>();

/** Tests: make the next gateway calls fail (network-style or refused). */
export const fakeControls = {
  failCreateOrder: false,
  failRefunds: 0,
  /** Pretend payments are only authorized; capture must be called. */
  manualCapture: false,
  reset() {
    this.failCreateOrder = false;
    this.failRefunds = 0;
    this.manualCapture = false;
    orders.clear();
    payments.clear();
    refunds.clear();
  },
};

function paymentEntity(payment: GatewayPayment) {
  return {
    id: payment.id,
    entity: "payment",
    amount: payment.amountPaise,
    currency: payment.currency,
    status: payment.status,
    order_id: payment.orderId,
    method: payment.method,
    error_description: payment.errorDescription,
  };
}

/** A webhook delivery as Razorpay would send it: body, signature and event id. */
export function fakeWebhook(event: string, payload: Record<string, object>) {
  const body = Buffer.from(
    JSON.stringify({
      entity: "event",
      event,
      contains: Object.keys(payload),
      payload: Object.fromEntries(Object.entries(payload).map(([key, entity]) => [key, { entity }])),
      created_at: Math.floor(Date.now() / 1000),
    })
  );
  const signature = createHmac("sha256", FAKE_WEBHOOK_SECRET).update(body).digest("hex");
  return { body, signature, eventId: id("evt") };
}

/**
 * The customer "pays" (or fails to) in the fake checkout. Returns what the
 * browser checkout would hand back, plus the webhook the gateway would send.
 */
export function simulateCheckout(orderId: string, outcome: "success" | "failure", amountPaise?: number) {
  const order = orders.get(orderId);
  if (!order) throw new GatewayError("Unknown order", true);

  const payment: GatewayPayment = {
    id: id("pay"),
    orderId,
    amountPaise: amountPaise ?? order.amountPaise,
    currency: "INR",
    status: outcome === "failure" ? "failed" : fakeControls.manualCapture ? "authorized" : "captured",
    method: "upi",
    errorDescription: outcome === "failure" ? "Payment declined by the bank (simulated)" : null,
    raw: null,
  };
  payment.raw = paymentEntity(payment);
  payments.set(payment.id, payment);

  const signature = createHmac("sha256", FAKE_KEY_SECRET).update(`${orderId}|${payment.id}`).digest("hex");
  const event = payment.status === "failed" ? "payment.failed" : payment.status === "captured" ? "payment.captured" : "payment.authorized";

  return {
    paymentId: payment.id,
    signature,
    webhook: fakeWebhook(event, { payment: paymentEntity(payment) }),
  };
}

function known(paymentId: string) {
  const payment = payments.get(paymentId);
  if (!payment) throw new GatewayError("The id provided does not exist", true);
  return payment;
}

export const fakeGateway: PaymentGateway = {
  name: "fake",
  publicKey: "rzp_fake_public",

  async createOrder({ amountPaise }) {
    if (fakeControls.failCreateOrder) throw new GatewayError("Gateway unavailable (simulated)");
    const order = { id: id("order"), amountPaise };
    orders.set(order.id, order);
    return { id: order.id, amountPaise, currency: "INR" };
  },

  async fetchPayment(paymentId) {
    return { ...known(paymentId) };
  },

  async fetchOrderPayments(orderId) {
    return [...payments.values()].filter((payment) => payment.orderId === orderId).reverse();
  },

  async capturePayment(paymentId, amountPaise) {
    const payment = known(paymentId);
    if (payment.status !== "authorized") throw new GatewayError("This payment has already been captured", true);
    if (payment.amountPaise !== amountPaise) throw new GatewayError("Capture amount must match", true);
    payment.status = "captured";
    payment.raw = paymentEntity(payment);
    return { ...payment };
  },

  async createRefund({ paymentId, amountPaise, receipt }) {
    if (fakeControls.failRefunds > 0) {
      fakeControls.failRefunds--;
      throw new GatewayError("Gateway unavailable (simulated)");
    }
    const payment = known(paymentId);
    const list = refunds.get(paymentId) ?? [];
    const already = list.reduce((sum, refund) => sum + refund.amountPaise, 0);
    if (already + amountPaise > payment.amountPaise) {
      throw new GatewayError("The total refund amount is greater than the refund payment amount", true);
    }
    const refund: GatewayRefund = { id: id("rfnd"), paymentId, amountPaise, status: "processed", receipt };
    refunds.set(paymentId, [...list, refund]);
    payment.status = "refunded";
    return { ...refund };
  },

  async fetchRefunds(paymentId) {
    return [...(refunds.get(paymentId) ?? [])];
  },

  verifyCheckoutSignature(orderId, paymentId, signature) {
    return hmacMatches(FAKE_KEY_SECRET, `${orderId}|${paymentId}`, signature);
  },

  verifyWebhookSignature(rawBody, signature) {
    return hmacMatches(FAKE_WEBHOOK_SECRET, rawBody, signature);
  },
};
