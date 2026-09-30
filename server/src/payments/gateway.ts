import { env } from "../config/env.js";
import { fakeGateway } from "./fake.js";
import { razorpayGateway } from "./razorpay.js";
import type { PaymentGateway } from "./types.js";

export * from "./types.js";

let override: PaymentGateway | null | undefined;

/** The configured gateway, or null when online payments are off. */
export function getGateway(): PaymentGateway | null {
  if (override !== undefined) return override;
  if (env.PAYMENT_GATEWAY === "razorpay") return razorpayGateway;
  if (env.PAYMENT_GATEWAY === "fake") return fakeGateway;
  return null;
}

/** Tests only: swap the gateway (undefined restores the configured one). */
export function setGatewayForTests(gateway: PaymentGateway | null | undefined) {
  override = gateway;
}
