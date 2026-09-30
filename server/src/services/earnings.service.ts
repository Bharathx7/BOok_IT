import prisma from "../config/prisma.js";
import { Prisma, type PaymentStatus } from "../generated/prisma/client.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { buildPaginationMeta, type PaginationParams } from "../utils/pagination.js";
import { recordAudit } from "./audit.service.js";
import { paymentSummarySelect } from "./payment.service.js";

// Reading the money side: what each provider earned (the ledger), what the
// platform took in, and payouts. Amounts are paise.

interface Range {
  from: Date;
  /** Exclusive. */
  to: Date;
}

const sumLedger = async (where: Prisma.LedgerEntryWhereInput) => {
  const sum = await prisma.ledgerEntry.aggregate({
    where,
    _sum: { grossPaise: true, commissionPaise: true, providerSharePaise: true },
  });
  return {
    grossPaise: sum._sum.grossPaise ?? 0,
    commissionPaise: sum._sum.commissionPaise ?? 0,
    providerSharePaise: sum._sum.providerSharePaise ?? 0,
  };
};

const ledgerInclude = {
  payment: { select: { method: true, capturedAt: true, gatewayPaymentId: true } },
  refund: { select: { reason: true, processedAt: true } },
  payout: { select: { id: true, reference: true, createdAt: true } },
} satisfies Prisma.LedgerEntryInclude;

/** A provider's earnings in a period, what's still to be paid out, and the entries. */
export async function getProviderEarnings(providerId: string, range: Range, pagination: PaginationParams) {
  const inRange = { providerId, createdAt: { gte: range.from, lt: range.to } } satisfies Prisma.LedgerEntryWhereInput;

  const [period, sales, refunds, unpaid, entries, total, payouts] = await Promise.all([
    sumLedger(inRange),
    sumLedger({ ...inRange, type: "SALE" }),
    sumLedger({ ...inRange, type: "REFUND" }),
    sumLedger({ providerId, payoutId: null }),
    prisma.ledgerEntry.findMany({
      where: inRange,
      include: ledgerInclude,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.ledgerEntry.count({ where: inRange }),
    prisma.payout.findMany({ where: { providerId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  // Booking and venue names for the entries on this page.
  const bookings = await prisma.booking.findMany({
    where: { id: { in: [...new Set(entries.map((entry) => entry.bookingId))] } },
    select: {
      id: true,
      bookingCode: true,
      startTime: true,
      user: { select: { name: true } },
      venue: { select: { id: true, name: true, timezone: true } },
    },
  });
  const byId = new Map(bookings.map((booking) => [booking.id, booking]));

  return {
    period,
    sales,
    refunds,
    unpaid,
    payouts,
    entries: entries.map((entry) => ({ ...entry, booking: byId.get(entry.bookingId) ?? null })),
    pagination: buildPaginationMeta(pagination, total),
  };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface PaymentListFilters {
  status?: PaymentStatus | undefined;
  q?: string | undefined;
}

export async function listPayments(filters: PaymentListFilters, pagination: PaginationParams) {
  const q = filters.q?.trim();
  const where: Prisma.PaymentWhereInput = {
    ...(filters.status && { status: filters.status as PaymentStatus }),
    ...(q && {
      OR: [
        { gatewayOrderId: q },
        { gatewayPaymentId: q },
        { booking: { bookingCode: { equals: q.toUpperCase() } } },
        { booking: { user: { email: { contains: q, mode: "insensitive" } } } },
      ],
    }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.payment.findMany({
      where,
      select: {
        ...paymentSummarySelect,
        gateway: true,
        gatewayOrderId: true,
        gatewayPaymentId: true,
        booking: {
          select: {
            id: true,
            bookingCode: true,
            status: true,
            startTime: true,
            user: { select: { id: true, name: true, email: true } },
            venue: { select: { id: true, name: true, timezone: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.payment.count({ where }),
  ]);

  return { items, pagination: buildPaginationMeta(pagination, total) };
}

/**
 * Money in and out for a period, plus anything that doesn't add up:
 * captured payments whose booking isn't live, paid-online bookings without
 * a captured payment, refunds stuck or failed, webhooks that failed.
 */
export async function getPaymentsSummary(range: Range) {
  const captured = { capturedAt: { gte: range.from, lt: range.to } } satisfies Prisma.PaymentWhereInput;
  const staleRefund = new Date(Date.now() - 60 * 60_000);

  const [paid, refunded, ledger, byMethod, orphanPayments, unpaidConfirmed, stuckRefunds, failedRefunds, failedWebhooks] =
    await Promise.all([
      prisma.payment.aggregate({ where: captured, _sum: { amountPaise: true }, _count: true }),
      prisma.refund.aggregate({
        where: { status: "PROCESSED", processedAt: { gte: range.from, lt: range.to } },
        _sum: { amountPaise: true },
        _count: true,
      }),
      sumLedger({ createdAt: { gte: range.from, lt: range.to } }),
      prisma.payment.groupBy({ by: ["method"], where: captured, _sum: { amountPaise: true }, _count: true }),
      // Money taken, booking not live, and no refund on its way.
      prisma.payment.findMany({
        where: {
          status: "CAPTURED",
          booking: { status: { in: ["CANCELLED", "EXPIRED", "AWAITING_PAYMENT"] } },
          refunds: { none: { status: { in: ["PENDING", "PROCESSED"] } } },
        },
        select: { id: true, amountPaise: true, gatewayPaymentId: true, booking: { select: { id: true, bookingCode: true, status: true } } },
        take: 50,
      }),
      // Online bookings confirmed at a pay-online venue with no captured payment
      // (and not free).
      prisma.booking.findMany({
        where: {
          source: "ONLINE",
          status: { in: ["CONFIRMED", "COMPLETED"] },
          totalPrice: { gte: 1 },
          venue: { paymentMode: "PAY_ONLINE" },
          createdAt: { gte: range.from, lt: range.to },
          payments: { none: { status: { in: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] } } },
        },
        select: { id: true, bookingCode: true, totalPrice: true, status: true },
        take: 50,
      }),
      prisma.refund.findMany({
        where: { status: "PENDING", createdAt: { lt: staleRefund } },
        select: { id: true, amountPaise: true, attempts: true, createdAt: true, paymentId: true },
        take: 50,
      }),
      prisma.refund.findMany({
        where: { status: "FAILED" },
        select: {
          id: true,
          amountPaise: true,
          failureReason: true,
          createdAt: true,
          payment: { select: { booking: { select: { id: true, bookingCode: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.webhookEvent.findMany({
        where: { processedAt: null, error: { not: null } },
        select: { id: true, event: true, error: true, receivedAt: true },
        orderBy: { receivedAt: "desc" },
        take: 20,
      }),
    ]);

  return {
    range,
    capturedPaise: paid._sum.amountPaise ?? 0,
    capturedCount: paid._count,
    refundedPaise: refunded._sum.amountPaise ?? 0,
    refundedCount: refunded._count,
    netPaise: (paid._sum.amountPaise ?? 0) - (refunded._sum.amountPaise ?? 0),
    commissionPaise: ledger.commissionPaise,
    providerSharePaise: ledger.providerSharePaise,
    byMethod: byMethod.map((row) => ({ method: row.method ?? "unknown", amountPaise: row._sum.amountPaise ?? 0, count: row._count })),
    issues: { orphanPayments, unpaidConfirmed, stuckRefunds, failedRefunds, failedWebhooks },
  };
}

/** Providers with earnings not yet paid out. */
export async function listPayoutBalances() {
  const rows = await prisma.ledgerEntry.groupBy({
    by: ["providerId"],
    where: { payoutId: null },
    _sum: { providerSharePaise: true, grossPaise: true, commissionPaise: true },
    _count: true,
  });
  const providers = await prisma.user.findMany({
    where: { id: { in: rows.map((row) => row.providerId) } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(providers.map((provider) => [provider.id, provider]));

  return rows
    .map((row) => ({
      provider: byId.get(row.providerId) ?? { id: row.providerId, name: "Unknown", email: "" },
      entries: row._count,
      grossPaise: row._sum.grossPaise ?? 0,
      commissionPaise: row._sum.commissionPaise ?? 0,
      duePaise: row._sum.providerSharePaise ?? 0,
    }))
    .sort((a, b) => b.duePaise - a.duePaise);
}

export async function listPayouts(pagination: PaginationParams, providerId?: string) {
  const where = providerId ? { providerId } : {};
  const [items, total] = await prisma.$transaction([
    prisma.payout.findMany({ where, orderBy: { createdAt: "desc" }, skip: pagination.skip, take: pagination.limit }),
    prisma.payout.count({ where }),
  ]);
  const providers = await prisma.user.findMany({
    where: { id: { in: [...new Set(items.map((item) => item.providerId))] } },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  return {
    items: items.map((item) => ({ ...item, provider: byId.get(item.providerId) ?? null })),
    pagination: buildPaginationMeta(pagination, total),
  };
}

/**
 * Records that everything owed to a provider (every unpaid ledger entry) was
 * transferred, e.g. by bank transfer with this reference. Entries created
 * while this runs aren't included: they're picked by id first.
 */
export async function recordPayout(
  actorId: string,
  input: { providerId: string; reference?: string | null | undefined; note?: string | null | undefined }
) {
  const provider = await prisma.user.findUnique({ where: { id: input.providerId }, select: { id: true, role: true } });
  if (!provider) throw new NotFoundError("Provider not found");

  const payout = await prisma.$transaction(async (tx) => {
    const entries = await tx.ledgerEntry.findMany({
      where: { providerId: input.providerId, payoutId: null },
      select: { id: true, providerSharePaise: true },
    });
    const amountPaise = entries.reduce((sum, entry) => sum + entry.providerSharePaise, 0);
    if (entries.length === 0 || amountPaise <= 0) throw new ConflictError("Nothing is owed to this provider");

    const created = await tx.payout.create({
      data: {
        providerId: input.providerId,
        amountPaise,
        reference: input.reference?.trim() || null,
        note: input.note?.trim() || null,
        createdById: actorId,
      },
    });
    const { count } = await tx.ledgerEntry.updateMany({
      where: { id: { in: entries.map((entry) => entry.id) }, payoutId: null },
      data: { payoutId: created.id },
    });
    if (count !== entries.length) throw new ConflictError("The balance changed in the meantime; refresh and try again");
    return created;
  });

  await recordAudit({
    action: "payout.recorded",
    entityType: "Payout",
    entityId: payout.id,
    after: { providerId: payout.providerId, amountPaise: payout.amountPaise, reference: payout.reference },
  });

  return payout;
}
