import api from "./api";
import type { PageParams, Paginated, Pagination } from "../lib/pagination";

// Online payments. Amounts from the API are paise (1 rupee = 100 paise).

export interface PaymentConfig {
  enabled: boolean;
  gateway: "razorpay" | "fake" | null;
  keyId: string | null;
  holdMinutes: number;
}

/** What the checkout needs to take a booking's payment. */
export interface CheckoutOrder {
  gateway: "razorpay" | "fake";
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  bookingId: string;
  expiresAt: string | null;
  description: string;
  prefill: { name: string; email: string; contact: string };
}

/** What the checkout hands back after a successful payment. */
export interface CheckoutResult {
  orderId: string;
  paymentId: string;
  signature: string;
}

export type PaymentStatus = "CREATED" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "PARTIALLY_REFUNDED" | "REFUNDED";
export type RefundStatus = "PENDING" | "PROCESSED" | "FAILED";

export interface PaymentSummary {
  id: string;
  amountPaise: number;
  currency: string;
  status: PaymentStatus;
  method: string | null;
  failureReason: string | null;
  capturedAt: string | null;
  refundedPaise: number;
  createdAt: string;
  refunds: { id: string; amountPaise: number; status: RefundStatus; reason: string; processedAt: string | null; createdAt: string }[];
}

let configPromise: Promise<PaymentConfig> | null = null;

/** Cached for the session; the server setting doesn't change while the app runs. */
export const getPaymentConfig = () => {
  configPromise ??= api
    .get<PaymentConfig>("/payments/config")
    .then((response) => response.data)
    .catch((error: unknown) => {
      configPromise = null;
      throw error;
    });
  return configPromise;
};

export const startPayment = async (bookingId: string) =>
  (await api.post<{ payment: CheckoutOrder }>(`/payments/bookings/${bookingId}/start`)).data.payment;

export const verifyPayment = async (result: CheckoutResult) =>
  (await api.post<{ booking: { id: string; status: string } }>("/payments/verify", result)).data.booking;

/** Development only (fake gateway): pay or fail an order. */
export const fakeCheckout = async (orderId: string, outcome: "success" | "failure") =>
  (await api.post<CheckoutResult>("/payments/fake/checkout", { orderId, outcome })).data;

// Provider

export interface LedgerTotals {
  grossPaise: number;
  commissionPaise: number;
  providerSharePaise: number;
}

export interface LedgerEntry {
  id: string;
  type: "SALE" | "REFUND";
  grossPaise: number;
  commissionPaise: number;
  providerSharePaise: number;
  createdAt: string;
  payment: { method: string | null; capturedAt: string | null; gatewayPaymentId: string | null };
  refund: { reason: string; processedAt: string | null } | null;
  payout: { id: string; reference: string | null; createdAt: string } | null;
  booking: {
    id: string;
    bookingCode: string | null;
    startTime: string;
    user: { name: string };
    venue: { id: string; name: string; timezone: string };
  } | null;
}

export interface Payout {
  id: string;
  providerId: string;
  amountPaise: number;
  reference: string | null;
  note: string | null;
  createdAt: string;
  provider?: { id: string; name: string; email: string } | null;
}

export interface ProviderEarnings {
  period: LedgerTotals;
  sales: LedgerTotals;
  refunds: LedgerTotals;
  unpaid: LedgerTotals;
  payouts: Payout[];
  entries: LedgerEntry[];
  pagination: Pagination;
}

export const getProviderEarnings = async (params: { from: string; to: string } & PageParams) =>
  (await api.get<ProviderEarnings>("/provider/earnings", { params })).data;

// Admin

export interface AdminPayment extends PaymentSummary {
  gateway: string;
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  booking: {
    id: string;
    bookingCode: string | null;
    status: string;
    startTime: string;
    user: { id: string; name: string; email: string };
    venue: { id: string; name: string; timezone: string };
  };
}

export const getAdminPayments = async (params: { status?: string; q?: string } & PageParams): Promise<Paginated<AdminPayment>> => {
  const { data } = await api.get<{ payments: AdminPayment[]; pagination: Pagination }>("/admin/payments", { params });
  return { items: data.payments, pagination: data.pagination };
};

export interface PaymentsSummary {
  capturedPaise: number;
  capturedCount: number;
  refundedPaise: number;
  refundedCount: number;
  netPaise: number;
  commissionPaise: number;
  providerSharePaise: number;
  byMethod: { method: string; amountPaise: number; count: number }[];
  issues: {
    orphanPayments: { id: string; amountPaise: number; gatewayPaymentId: string | null; booking: { id: string; bookingCode: string | null; status: string } }[];
    unpaidConfirmed: { id: string; bookingCode: string | null; totalPrice: string; status: string }[];
    stuckRefunds: { id: string; amountPaise: number; attempts: number; createdAt: string }[];
    failedRefunds: { id: string; amountPaise: number; failureReason: string | null; createdAt: string; payment: { booking: { id: string; bookingCode: string | null } } }[];
    failedWebhooks: { id: string; event: string; error: string | null; receivedAt: string }[];
  };
}

export const getPaymentsSummary = async (from: string, to: string) =>
  (await api.get<PaymentsSummary>("/admin/payments/summary", { params: { from, to } })).data;

export const retryRefund = async (refundId: string) => {
  await api.post(`/admin/refunds/${refundId}/retry`);
};

export interface PayoutBalance {
  provider: { id: string; name: string; email: string };
  entries: number;
  grossPaise: number;
  commissionPaise: number;
  duePaise: number;
}

export const getPayouts = async (params: PageParams = {}) =>
  (await api.get<{ balances: PayoutBalance[]; payouts: Payout[]; pagination: Pagination }>("/admin/payouts", { params })).data;

export const recordPayout = async (body: { providerId: string; reference?: string; note?: string }) =>
  (await api.post<{ payout: Payout }>("/admin/payouts", body)).data.payout;
