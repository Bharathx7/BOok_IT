import { createHash } from "node:crypto";

import prisma from "../config/prisma.js";
import { env } from "../config/env.js";
import { Prisma, type Payment, type PaymentStatus } from "../generated/prisma/client.js";
import { QUEUES, enqueue, registerHandler } from "../jobs/queue.js";
import { GatewayError, getGateway, type GatewayPayment } from "../payments/gateway.js";
import { emitBookingEvent } from "../sockets/socket.js";
import { runInBackground } from "../utils/background.js";
import { isExclusionViolation } from "../utils/dbErrors.js";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { reportError } from "../utils/monitoring.js";
import { bookingPartiesInclude } from "./bookingLifecycle.service.js";
import { HOLDING_STATUSES } from "./bookingHolds.js";
import {
  notifyOwnerPaidBooking,
  notifyPaymentConfirmed,
  notifyRefundProcessed,
} from "./bookingNotifications.service.js";
import { getSetting } from "./settings.service.js";
import { markWaitlistBooked } from "./waitlist.service.js";

// Online payments. The flow for a pay-online venue:
//
// 1. createBooking makes the booking AWAITING_PAYMENT; it holds the time for
//    PAYMENT_HOLD_MINUTES. startPayment creates a gateway order for the
//    amount the server priced (the client never sends an amount).
// 2. The browser checkout pays the order and hands back a signed result;
//    verifyCheckout checks it with the gateway.
// 3. The gateway's webhook is the source of truth: it also reports the
//    payment (signed, de-duplicated by event id), in case the browser closed.
//    A sweep polls the gateway for orders neither reported (reconcile).
// 4. settleCapturedPayment confirms the booking - once, however many of
//    these report the same payment. A payment for a booking that expired
//    meanwhile revives it if the time is still free, otherwise it's refunded.
// 5. Cancelling a paid booking refunds what the venue's policy allows, via
//    a retried job (processRefund) that can't refund twice.
//
// All amounts here are paise (integers).

export class PaymentUnavailableError extends AppError {
  constructor(message = "Online payments are unavailable right now. Please try again in a few minutes.") {
    super(503, message);
  }
}

/** Rupees (a Decimal from the database, or a number) to paise. */
export const toPaise = (rupees: Prisma.Decimal | number | string | null | undefined) =>
  Math.round(Number(rupees ?? 0) * 100);

/** Razorpay's smallest order is ₹1; anything below is treated as free. */
const MIN_ORDER_PAISE = 100;

/** Does this venue take payment when booking (and are payments switched on)? */
export const paysOnline = (venue: { paymentMode: string }) =>
  venue.paymentMode === "PAY_ONLINE" && getGateway() !== null;

/** Unpaid bookings hold their time this long, but never past the start. */
export const paymentHoldUntil = (startTime: Date, now = new Date()) =>
  new Date(Math.min(now.getTime() + env.PAYMENT_HOLD_MINUTES * 60_000, startTime.getTime()));

export const isFreeAmount = (paise: number) => paise < MIN_ORDER_PAISE;

export function paymentConfig() {
  const gateway = getGateway();
  return {
    enabled: gateway !== null,
    gateway: gateway?.name ?? null,
    keyId: gateway?.publicKey ?? null,
    holdMinutes: env.PAYMENT_HOLD_MINUTES,
  };
}

/** Logs a payment problem and reports it to error tracking (when set up). */
function failure(error: unknown, task: string, extra?: Record<string, string | number | null>) {
  logger.error({ err: error, ...extra }, `Payments: ${task}`);
  reportError(error, { task, extra });
}

const requireGateway = () => {
  const gateway = getGateway();
  if (!gateway) throw new PaymentUnavailableError("Online payments are not enabled");
  return gateway;
};

// ---------------------------------------------------------------------------
// Starting a payment
// ---------------------------------------------------------------------------

const checkoutBookingInclude = {
  user: { select: { id: true, name: true, email: true, phone: true } },
  venue: { select: { id: true, name: true } },
} satisfies Prisma.BookingInclude;

/**
 * The gateway order for an unpaid booking, created on first use and reused
 * afterwards (Razorpay lets a customer retry a failed attempt on the same
 * order). Returns what the browser checkout needs.
 */
export async function startPayment(bookingId: string, userId: string) {
  const gateway = requireGateway();
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: checkoutBookingInclude });

  if (!booking || booking.userId !== userId) throw new NotFoundError("Booking not found");
  if (booking.status !== "AWAITING_PAYMENT") {
    throw new ConflictError(
      booking.status === "EXPIRED"
        ? "The time to pay for this booking ran out. Please book again."
        : "This booking doesn't need a payment"
    );
  }
  if (booking.expiresAt && booking.expiresAt <= new Date()) {
    throw new ConflictError("The time to pay for this booking ran out. Please book again.");
  }

  const amountPaise = toPaise(booking.totalPrice);
  let payment = await prisma.payment.findFirst({
    where: {
      bookingId,
      gateway: gateway.name,
      amountPaise,
      status: { in: ["CREATED", "FAILED"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!payment) {
    let order;
    try {
      order = await gateway.createOrder({
        amountPaise,
        receipt: booking.bookingCode ?? booking.id,
        notes: { bookingId: booking.id, venueId: booking.venueId },
      });
    } catch (error) {
      failure(error, "payment:create-order", { bookingId });
      throw new PaymentUnavailableError();
    }

    payment = await prisma.payment.create({
      data: {
        bookingId,
        userId,
        amountPaise: order.amountPaise,
        currency: order.currency,
        gateway: gateway.name,
        gatewayOrderId: order.id,
      },
    });
  }

  return {
    gateway: gateway.name,
    keyId: gateway.publicKey,
    orderId: payment.gatewayOrderId,
    amountPaise: payment.amountPaise,
    currency: payment.currency,
    bookingId,
    expiresAt: booking.expiresAt,
    description: `${booking.venue.name}${booking.bookingCode ? ` · ${booking.bookingCode}` : ""}`,
    prefill: { name: booking.user.name, email: booking.user.email, contact: booking.user.phone ?? "" },
  };
}

// ---------------------------------------------------------------------------
// Recording what the gateway reports
// ---------------------------------------------------------------------------

/**
 * The browser says the customer paid. The signature proves the result came
 * from the gateway checkout; the payment is then fetched from the gateway so
 * nothing the browser sends is trusted on its own.
 */
export async function verifyCheckout(
  userId: string,
  input: { orderId: string; paymentId: string; signature: string }
) {
  const gateway = requireGateway();
  const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: input.orderId } });

  if (!payment || payment.userId !== userId) throw new NotFoundError("Payment not found");
  if (!gateway.verifyCheckoutSignature(input.orderId, input.paymentId, input.signature)) {
    throw new ValidationError("The payment could not be verified");
  }

  let reported: GatewayPayment;
  try {
    reported = await gateway.fetchPayment(input.paymentId);
  } catch (error) {
    // The webhook or the reconcile sweep will still pick it up.
    failure(error, "payment:verify", { paymentId: payment.id });
    throw new PaymentUnavailableError(
      "We couldn't confirm your payment with the bank yet. If money was taken, your booking will be confirmed within a few minutes."
    );
  }

  if (reported.orderId !== input.orderId) throw new ValidationError("The payment could not be verified");
  await recordGatewayPayment(reported);

  return prisma.booking.findUniqueOrThrow({
    where: { id: payment.bookingId },
    include: { venue: true, payments: { select: paymentSummarySelect, orderBy: { createdAt: "desc" } } },
  });
}

/**
 * Applies a payment as reported by the gateway (checkout, webhook or the
 * reconcile sweep). Safe to call any number of times for the same payment.
 */
export async function recordGatewayPayment(reported: GatewayPayment) {
  const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: reported.orderId } });

  if (!payment) {
    logger.warn({ orderId: reported.orderId }, "Payment reported for an unknown order");
    return;
  }

  if (reported.currency !== payment.currency || reported.amountPaise !== payment.amountPaise) {
    // Can't happen with a real gateway (the order fixes the amount); never settle it.
    failure(new Error("Payment amount does not match its order"), "payment:mismatch", {
      paymentId: payment.id,
      reported: reported.amountPaise,
      expected: payment.amountPaise,
    });
    return;
  }

  if (reported.status === "failed") {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: { in: ["CREATED", "FAILED"] } },
      data: {
        status: "FAILED",
        failureReason: reported.errorDescription ?? "Payment failed",
        method: reported.method,
        raw: toJson(reported.raw),
      },
    });
    return;
  }

  if (reported.status === "created") return;

  let captured = reported;
  if (reported.status === "authorized") {
    // Accounts without auto-capture: take the money now.
    captured = await requireGateway().capturePayment(reported.id, payment.amountPaise);
  }

  if (captured.status === "captured" || captured.status === "refunded") {
    await settleCapturedPayment(payment, captured);
  }
}

const toJson = (value: unknown) => (value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue));

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------

/** Room for a slow database: this transaction decides whether a paid booking stands. */
const SETTLE_TX = { maxWait: 10_000, timeout: 15_000 };

type SettleOutcome =
  | { kind: "already" }
  | { kind: "confirmed"; revived: boolean }
  | { kind: "refund"; refundId: string };

/**
 * Marks the payment captured and confirms its booking, exactly once. The
 * venue is locked (same lock as creating bookings), so a payment arriving
 * for an expired booking can't grab a time someone else is booking now.
 */
export async function settleCapturedPayment(payment: Payment, captured: GatewayPayment): Promise<SettleOutcome> {
  let outcome: SettleOutcome;
  // Read before taking the lock: the transaction should stay short.
  const commissionPercent = await getSetting("commissionPercent");

  try {
    outcome = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: payment.bookingId },
        include: { venue: { select: { ownerId: true } } },
      });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${booking.venueId}, 0))`;

      const { count } = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ["CREATED", "AUTHORIZED", "FAILED"] } },
        data: {
          status: "CAPTURED",
          gatewayPaymentId: captured.id,
          method: captured.method,
          failureReason: null,
          capturedAt: new Date(),
          raw: toJson(captured.raw),
        },
      });
      if (count === 0) return { kind: "already" } as const;

      const refundAll = async (reason: string) => ({
        kind: "refund" as const,
        refundId: await createRefundRecord(tx, payment.id, payment.amountPaise, reason),
      });

      const otherCaptured = await tx.payment.count({
        where: { bookingId: booking.id, id: { not: payment.id }, status: { in: ["CAPTURED", "PARTIALLY_REFUNDED"] } },
      });
      if (otherCaptured > 0) return refundAll("Duplicate payment for the same booking");

      if (booking.status === "AWAITING_PAYMENT") {
        await tx.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED", expiresAt: null } });
        await recordSale(tx, payment, booking, commissionPercent);
        return { kind: "confirmed", revived: false } as const;
      }

      if (booking.status === "EXPIRED" && booking.startTime > new Date()) {
        // Paid after the hold ran out: keep it if nobody took the time since.
        const clash = await tx.booking.findFirst({
          where: {
            venueId: booking.venueId,
            id: { not: booking.id },
            status: { in: [...HOLDING_STATUSES] },
            startTime: { lt: booking.endTime },
            endTime: { gt: booking.startTime },
          },
          select: { id: true },
        });
        if (!clash) {
          await tx.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED", expiresAt: null } });
          await recordSale(tx, payment, booking, commissionPercent);
          return { kind: "confirmed", revived: true } as const;
        }
        return refundAll("Paid after the booking had expired and the time was taken");
      }

      if (booking.status === "CONFIRMED" || booking.status === "COMPLETED") {
        // Free bookings are confirmed without a payment; nothing should be paid for them.
        return refundAll("The booking was already confirmed");
      }

      return refundAll(
        booking.status === "CANCELLED" ? "Paid for a booking that was cancelled" : "Paid after the booking had expired"
      );
    }, SETTLE_TX);
  } catch (error) {
    if (isExclusionViolation(error)) {
      // Lost a race for the time; take the payment back.
      return settleAsRefund(payment, captured);
    }
    throw error;
  }

  await afterSettle(payment, outcome);
  return outcome;
}

/** Fallback when confirming hit the overlap constraint: record the capture and refund it. */
async function settleAsRefund(payment: Payment, captured: GatewayPayment): Promise<SettleOutcome> {
  const outcome = await prisma.$transaction(async (tx) => {
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: ["CREATED", "AUTHORIZED", "FAILED"] } },
      data: { status: "CAPTURED", gatewayPaymentId: captured.id, method: captured.method, capturedAt: new Date(), raw: toJson(captured.raw) },
    });
    if (count === 0) return { kind: "already" } as const;
    return {
      kind: "refund" as const,
      refundId: await createRefundRecord(tx, payment.id, payment.amountPaise, "Paid after the booking had expired and the time was taken"),
    };
  });
  await afterSettle(payment, outcome);
  return outcome;
}

async function afterSettle(payment: Payment, outcome: SettleOutcome) {
  if (outcome.kind === "refund") {
    await enqueueRefund(outcome.refundId);
    return;
  }
  if (outcome.kind !== "confirmed") return;

  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: payment.bookingId },
    include: bookingPartiesInclude,
  });

  try {
    emitBookingEvent("bookingConfirmed", booking, booking.venue.ownerId);
  } catch {
    // Socket.io isn't running (scripts).
  }
  runInBackground("waitlist booked", () =>
    markWaitlistBooked(booking.userId, booking.venueId, booking.startTime, booking.endTime)
  );
  runInBackground("paid booking notifications", async () => {
    await notifyPaymentConfirmed(booking, payment.amountPaise);
    await notifyOwnerPaidBooking(booking, payment.amountPaise);
  });
}

// ---------------------------------------------------------------------------
// Ledger (the provider's share)
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

const commissionOf = (grossPaise: number, percent: number) => Math.round((grossPaise * percent) / 100);

async function recordSale(
  tx: Tx,
  payment: Payment,
  booking: { id: string; venueId: string; venue: { ownerId: string } },
  percent: number
) {
  const commissionPaise = commissionOf(payment.amountPaise, percent);

  await tx.ledgerEntry.create({
    data: {
      type: "SALE",
      providerId: booking.venue.ownerId,
      venueId: booking.venueId,
      bookingId: booking.id,
      paymentId: payment.id,
      grossPaise: payment.amountPaise,
      commissionPaise,
      providerSharePaise: payment.amountPaise - commissionPaise,
    },
  });
}

/**
 * A refund takes back the same share of the commission as of the sale, so
 * the platform keeps commission only on money it keeps. Refunds of payments
 * that were never a sale (duplicates, late payments) touch no ledger.
 */
async function recordRefundInLedger(tx: Tx, refund: { id: string; amountPaise: number; paymentId: string }) {
  const sale = await tx.ledgerEntry.findFirst({ where: { paymentId: refund.paymentId, type: "SALE" } });
  if (!sale) return;

  const commissionPaise = Math.round((sale.commissionPaise * refund.amountPaise) / sale.grossPaise);
  await tx.ledgerEntry.create({
    data: {
      type: "REFUND",
      providerId: sale.providerId,
      venueId: sale.venueId,
      bookingId: sale.bookingId,
      paymentId: sale.paymentId,
      refundId: refund.id,
      grossPaise: -refund.amountPaise,
      commissionPaise: -commissionPaise,
      providerSharePaise: -(refund.amountPaise - commissionPaise),
    },
  });
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

/** Paise of a payment not yet refunded or promised back. */
async function refundablePaise(tx: Tx, paymentId: string) {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const pending = await tx.refund.aggregate({
    where: { paymentId, status: { in: ["PENDING", "PROCESSED"] } },
    _sum: { amountPaise: true },
  });
  return payment.amountPaise - (pending._sum.amountPaise ?? 0);
}

async function createRefundRecord(tx: Tx, paymentId: string, amountPaise: number, reason: string) {
  const available = await refundablePaise(tx, paymentId);
  const refund = await tx.refund.create({
    data: { paymentId, amountPaise: Math.min(amountPaise, available), reason },
  });
  return refund.id;
}

/**
 * Called in the cancellation transaction: promises back `amountPaise` of the
 * booking's captured payment. Returns the refund ids to send once committed.
 */
export async function refundForCancellation(tx: Tx, bookingId: string, amountPaise: number, reason: string) {
  if (amountPaise <= 0) return [];
  const payments = await tx.payment.findMany({
    where: { bookingId, status: { in: ["CAPTURED", "PARTIALLY_REFUNDED"] } },
    orderBy: { capturedAt: "asc" },
  });

  const ids: string[] = [];
  let remaining = amountPaise;
  for (const payment of payments) {
    if (remaining <= 0) break;
    const available = await refundablePaise(tx, payment.id);
    const amount = Math.min(available, remaining);
    if (amount <= 0) continue;
    ids.push((await tx.refund.create({ data: { paymentId: payment.id, amountPaise: amount, reason } })).id);
    remaining -= amount;
  }
  return ids;
}

/** Captured paise on a booking (what cancelling can refund). */
export async function paidPaise(client: Pick<Tx, "payment">, bookingId: string) {
  const sum = await client.payment.aggregate({
    where: { bookingId, status: { in: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] } },
    _sum: { amountPaise: true },
  });
  return sum._sum.amountPaise ?? 0;
}

export async function enqueueRefund(refundId: string) {
  await enqueue(QUEUES.payments, { refundId }, { singletonKey: `refund:${refundId}` });
}

/**
 * Sends a refund to the gateway. Retried by the job queue on network errors.
 * Before creating one it looks for a refund already made with our id as the
 * receipt, so a crash between the gateway call and saving can't refund twice.
 */
export async function processRefund(refundId: string) {
  const refund = await prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
  if (!refund || refund.status !== "PENDING") return;

  const gateway = requireGateway();
  const gatewayPaymentId = refund.payment.gatewayPaymentId;
  if (!gatewayPaymentId) throw new Error(`Refund ${refundId}: payment has no gateway payment id`);

  try {
    let result = refund.gatewayRefundId
      ? (await gateway.fetchRefunds(gatewayPaymentId)).find((r) => r.id === refund.gatewayRefundId)
      : (await gateway.fetchRefunds(gatewayPaymentId)).find((r) => r.receipt === refund.id);

    if (!result) {
      result = await gateway.createRefund({ paymentId: gatewayPaymentId, amountPaise: refund.amountPaise, receipt: refund.id });
    }

    await prisma.refund.update({ where: { id: refund.id }, data: { gatewayRefundId: result.id } });

    if (result.status === "processed") await markRefundProcessed(refund.id);
    else if (result.status === "failed") await markRefundFailed(refund.id, "The gateway could not process the refund");
    // "pending": the refund.processed webhook (or the next sweep) finishes it.
  } catch (error) {
    if (error instanceof GatewayError && error.rejected) {
      await markRefundFailed(refund.id, error.message);
      failure(error, "payment:refund-rejected", { refundId });
      return;
    }
    await prisma.refund.update({ where: { id: refund.id }, data: { attempts: { increment: 1 } } });
    throw error;
  }
}

export async function markRefundProcessed(refundId: string) {
  const done = await prisma.$transaction(async (tx) => {
    const { count } = await tx.refund.updateMany({
      where: { id: refundId, status: "PENDING" },
      data: { status: "PROCESSED", processedAt: new Date(), failureReason: null },
    });
    if (count === 0) return null;

    const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    const payment = await tx.payment.update({
      where: { id: refund.paymentId },
      data: { refundedPaise: { increment: refund.amountPaise } },
    });
    const status: PaymentStatus = payment.refundedPaise >= payment.amountPaise ? "REFUNDED" : "PARTIALLY_REFUNDED";
    await tx.payment.update({ where: { id: payment.id }, data: { status } });
    await recordRefundInLedger(tx, refund);
    return { refund, bookingId: payment.bookingId };
  });

  if (done) {
    runInBackground("refund notification", async () => {
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: done.bookingId }, include: bookingPartiesInclude });
      await notifyRefundProcessed(booking, done.refund.amountPaise);
    });
  }
}

async function markRefundFailed(refundId: string, reason: string) {
  await prisma.refund.updateMany({ where: { id: refundId, status: "PENDING" }, data: { status: "FAILED", failureReason: reason } });
}

/** Admin: send a failed refund again (e.g. after fixing the gateway account). */
export async function retryRefund(refundId: string) {
  const { count } = await prisma.refund.updateMany({
    where: { id: refundId, status: "FAILED" },
    data: { status: "PENDING", failureReason: null },
  });
  if (count === 0) throw new ConflictError("Only failed refunds can be retried");
  await enqueueRefund(refundId);
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

interface WebhookBody {
  event?: string;
  payload?: {
    payment?: { entity?: RazorpayPaymentEntity };
    refund?: { entity?: { id: string; payment_id: string; amount: number; status: string; receipt?: string | null } };
  };
}

interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: GatewayPayment["status"];
  method?: string | null;
  error_description?: string | null;
}

const fromEntity = (entity: RazorpayPaymentEntity): GatewayPayment => ({
  id: entity.id,
  orderId: entity.order_id,
  amountPaise: entity.amount,
  currency: entity.currency,
  status: entity.status,
  method: entity.method ?? null,
  errorDescription: entity.error_description ?? null,
  raw: entity,
});

/**
 * One webhook delivery. Verified against the raw body, stored by event id,
 * and skipped if that event was already processed (gateways retry
 * deliveries). If processing fails the event stays unprocessed and the
 * error propagates, so the gateway delivers it again.
 */
export async function handleWebhook(rawBody: Buffer, signature: string | undefined, eventId: string | undefined) {
  const gateway = getGateway();
  if (!gateway) throw new NotFoundError("Online payments are not enabled");
  if (!signature || !gateway.verifyWebhookSignature(rawBody, signature)) {
    throw new ValidationError("Invalid webhook signature");
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody.toString("utf8")) as WebhookBody;
  } catch {
    throw new ValidationError("Invalid webhook body");
  }

  const event = body.event ?? "unknown";
  const id = eventId || `${event}:${createDigest(rawBody)}`;

  const stored = await prisma.webhookEvent.upsert({
    where: { id },
    create: { id, gateway: gateway.name, event, payload: body as Prisma.InputJsonValue },
    update: {},
  });
  if (stored.processedAt) return { duplicate: true };

  try {
    await applyWebhook(body);
    await prisma.webhookEvent.update({ where: { id }, data: { processedAt: new Date(), error: null } });
  } catch (error) {
    await prisma.webhookEvent.update({
      where: { id },
      data: { error: error instanceof Error ? error.message.slice(0, 500) : String(error) },
    });
    throw error;
  }

  return { duplicate: false };
}

async function applyWebhook(body: WebhookBody) {
  const paymentEntity = body.payload?.payment?.entity;
  const refundEntity = body.payload?.refund?.entity;

  switch (body.event) {
    case "payment.authorized":
    case "payment.captured":
    case "payment.failed":
    case "order.paid":
      if (paymentEntity) await recordGatewayPayment(fromEntity(paymentEntity));
      return;
    case "refund.processed":
    case "refund.failed": {
      if (!refundEntity) return;
      const refund = await prisma.refund.findFirst({
        where: { OR: [{ gatewayRefundId: refundEntity.id }, ...(refundEntity.receipt ? [{ id: refundEntity.receipt }] : [])] },
      });
      if (!refund) return; // A refund made in the gateway dashboard, not by the app.
      if (!refund.gatewayRefundId) {
        await prisma.refund.update({ where: { id: refund.id }, data: { gatewayRefundId: refundEntity.id } });
      }
      if (body.event === "refund.processed") await markRefundProcessed(refund.id);
      else await markRefundFailed(refund.id, "The gateway could not process the refund");
      return;
    }
    default:
      // Other events aren't used.
      return;
  }
}

const createDigest = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 32);

// ---------------------------------------------------------------------------
// Reconcile sweep
// ---------------------------------------------------------------------------

const RECONCILE_AFTER_MS = 2 * 60_000;
const RECONCILE_WINDOW_MS = 24 * 60 * 60_000;
const RECONCILE_BATCH = 20;

/**
 * Asks the gateway about orders still unpaid here after a couple of minutes:
 * catches payments whose browser closed and whose webhook never arrived.
 * Also retries refunds the gateway left "pending". Runs every minute; each
 * order is checked at most every few minutes (its updatedAt is bumped).
 */
export async function reconcilePayments(now = new Date()) {
  const gateway = getGateway();
  if (!gateway) return 0;

  const stale = await prisma.payment.findMany({
    where: {
      gateway: gateway.name,
      status: { in: ["CREATED", "AUTHORIZED", "FAILED"] },
      createdAt: { gt: new Date(now.getTime() - RECONCILE_WINDOW_MS) },
      updatedAt: { lt: new Date(now.getTime() - RECONCILE_AFTER_MS) },
    },
    orderBy: { updatedAt: "asc" },
    take: RECONCILE_BATCH,
  });

  let found = 0;
  for (const payment of stale) {
    try {
      const attempts = await gateway.fetchOrderPayments(payment.gatewayOrderId);
      const paid = attempts.find((attempt) => ["captured", "authorized", "refunded"].includes(attempt.status));
      if (paid) {
        await recordGatewayPayment(paid);
        found++;
      } else {
        await prisma.payment.update({ where: { id: payment.id }, data: { updatedAt: now } });
      }
    } catch (error) {
      failure(error, "payment:reconcile", { paymentId: payment.id });
    }
  }

  // Refunds the gateway accepted but hadn't finished.
  const waiting = await prisma.refund.findMany({
    where: { status: "PENDING", updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
    select: { id: true },
    take: RECONCILE_BATCH,
  });
  for (const { id } of waiting) {
    await prisma.refund.update({ where: { id }, data: { updatedAt: now } });
    await enqueueRefund(id);
  }

  return found;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export const paymentSummarySelect = {
  id: true,
  amountPaise: true,
  currency: true,
  status: true,
  method: true,
  failureReason: true,
  capturedAt: true,
  refundedPaise: true,
  createdAt: true,
  refunds: {
    select: { id: true, amountPaise: true, status: true, reason: true, processedAt: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.PaymentSelect;

registerHandler<{ refundId: string }>(QUEUES.payments, ({ refundId }) => processRefund(refundId));
registerHandler(QUEUES.paymentReconcile, () => reconcilePayments());
