import { env } from "../config/env.js";
import {
  GatewayError,
  hmacMatches,
  type GatewayOrder,
  type GatewayPayment,
  type GatewayRefund,
  type PaymentGateway,
} from "./types.js";

// Razorpay's REST API (https://razorpay.com/docs/api/), called directly: the
// few endpoints used here don't need the SDK. Test and live mode differ only
// by the key pair.

const API = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 15_000;

interface RazorpayPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: GatewayPayment["status"];
  method?: string | null;
  error_description?: string | null;
}

interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: GatewayRefund["status"];
  receipt?: string | null;
}

async function call<T>(method: "GET" | "POST", path: string, body?: object): Promise<T> {
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64");
  let response: Response;

  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      ...(body && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new GatewayError(`Razorpay is unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const data = (await response.json().catch(() => null)) as
    | (T & { error?: { description?: string } })
    | null;

  if (!response.ok) {
    const description = data?.error?.description ?? `HTTP ${response.status}`;
    // 4xx: Razorpay refused the request (retrying won't help); 5xx: try again later.
    throw new GatewayError(`Razorpay: ${description}`, response.status >= 400 && response.status < 500);
  }

  return data as T;
}

const toPayment = (payment: RazorpayPayment): GatewayPayment => ({
  id: payment.id,
  orderId: payment.order_id,
  amountPaise: payment.amount,
  currency: payment.currency,
  status: payment.status,
  method: payment.method ?? null,
  errorDescription: payment.error_description ?? null,
  raw: payment,
});

const toRefund = (refund: RazorpayRefund): GatewayRefund => ({
  id: refund.id,
  paymentId: refund.payment_id,
  amountPaise: refund.amount,
  status: refund.status,
  receipt: refund.receipt ?? null,
});

export const razorpayGateway: PaymentGateway = {
  name: "razorpay",
  get publicKey() {
    return env.RAZORPAY_KEY_ID ?? "";
  },

  async createOrder({ amountPaise, receipt, notes }) {
    const order = await call<{ id: string; amount: number; currency: string }>("POST", "/orders", {
      amount: amountPaise,
      currency: "INR",
      // Razorpay caps receipts at 40 characters.
      receipt: receipt.slice(0, 40),
      notes,
    });
    return { id: order.id, amountPaise: order.amount, currency: order.currency } satisfies GatewayOrder;
  },

  async fetchPayment(paymentId) {
    return toPayment(await call<RazorpayPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`));
  },

  async fetchOrderPayments(orderId) {
    const list = await call<{ items: RazorpayPayment[] }>("GET", `/orders/${encodeURIComponent(orderId)}/payments`);
    return list.items.map(toPayment);
  },

  async capturePayment(paymentId, amountPaise) {
    return toPayment(
      await call<RazorpayPayment>("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, {
        amount: amountPaise,
        currency: "INR",
      })
    );
  },

  async createRefund({ paymentId, amountPaise, receipt }) {
    return toRefund(
      await call<RazorpayRefund>("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, {
        amount: amountPaise,
        speed: "normal",
        receipt: receipt.slice(0, 40),
      })
    );
  },

  async fetchRefunds(paymentId) {
    const list = await call<{ items: RazorpayRefund[] }>("GET", `/payments/${encodeURIComponent(paymentId)}/refunds`);
    return list.items.map(toRefund);
  },

  verifyCheckoutSignature(orderId, paymentId, signature) {
    return hmacMatches(env.RAZORPAY_KEY_SECRET ?? "", `${orderId}|${paymentId}`, signature);
  },

  verifyWebhookSignature(rawBody, signature) {
    return hmacMatches(env.RAZORPAY_WEBHOOK_SECRET ?? "", rawBody, signature);
  },
};
