import { createHmac, timingSafeEqual } from "node:crypto";

// What the app needs from a payment gateway. Amounts are always paise.

export interface GatewayOrder {
  id: string;
  amountPaise: number;
  currency: string;
}

export type GatewayPaymentStatus = "created" | "authorized" | "captured" | "refunded" | "failed";

export interface GatewayPayment {
  id: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  status: GatewayPaymentStatus;
  method: string | null;
  errorDescription: string | null;
  raw: unknown;
}

export interface GatewayRefund {
  id: string;
  paymentId: string;
  amountPaise: number;
  status: "pending" | "processed" | "failed";
  /** Our Refund id, so a refund created before a crash can be found again. */
  receipt: string | null;
}

export interface PaymentGateway {
  name: "razorpay" | "fake";
  /** Public key the browser checkout needs (never the secret). */
  publicKey: string;
  createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<GatewayOrder>;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  /** Payments on this order, newest first (to recover one the browser never reported). */
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;
  capturePayment(paymentId: string, amountPaise: number): Promise<GatewayPayment>;
  createRefund(input: { paymentId: string; amountPaise: number; receipt: string }): Promise<GatewayRefund>;
  fetchRefunds(paymentId: string): Promise<GatewayRefund[]>;
  /** Checks the signature the checkout returns with a successful payment. */
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean;
  /** Checks a webhook delivery against the raw request body. */
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}

/** HMAC-SHA256 hex digest compared in constant time. */
export function hmacMatches(secret: string, payload: string | Buffer, signature: string) {
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const given = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export class GatewayError extends Error {
  constructor(
    message: string,
    /** The gateway said no (bad request), as opposed to being unreachable. */
    readonly rejected = false
  ) {
    super(message);
    this.name = "GatewayError";
  }
}
