import prisma from "../config/prisma.js";
import type { Coupon, CouponType, Prisma } from "../generated/prisma/client.js";
import { isUniqueViolation } from "../utils/dbErrors.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { buildPaginationMeta, type PaginationParams } from "../utils/pagination.js";
import { changedFields, recordAudit } from "./audit.service.js";
import { quoteForVenue } from "./pricing.service.js";
import { findPublicVenue } from "./venueVisibility.js";

// Discount codes, applied when a customer books. A use is a booking that
// still counts (pending, confirmed or completed); cancelling or letting a
// request expire gives the use back.

// An unpaid booking uses the code until its payment hold lapses.
const COUNTING_STATUSES = ["AWAITING_PAYMENT", "PENDING", "CONFIRMED", "COMPLETED"] as const;

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export const normalizeCouponCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");

/** Rupees off a subtotal; never more than the subtotal itself. */
export function computeDiscount(
  coupon: Pick<Coupon, "type" | "value" | "maxDiscount">,
  subtotal: number
) {
  const value = Number(coupon.value);
  let discount = coupon.type === "PERCENT" ? (subtotal * value) / 100 : value;

  if (coupon.type === "PERCENT" && coupon.maxDiscount !== null) {
    discount = Math.min(discount, Number(coupon.maxDiscount));
  }

  return roundMoney(Math.max(0, Math.min(discount, subtotal)));
}

type Tx = Prisma.TransactionClient;

/**
 * Checks every rule for this customer, venue and amount and returns the
 * coupon with its discount. Inside a booking transaction, call lockCoupon
 * first so two bookings can't both take the last use.
 */
export async function checkCoupon(
  client: Tx | typeof prisma,
  input: { code: string; userId: string; venueId: string; subtotal: number; now?: Date }
) {
  const now = input.now ?? new Date();
  const coupon = await client.coupon.findUnique({ where: { code: normalizeCouponCode(input.code) } });

  const invalid = (message: string) => new ValidationError(message, [{ field: "couponCode", message }]);

  if (!coupon || !coupon.isActive) throw invalid("This code isn't valid");
  if (coupon.validFrom && now < coupon.validFrom) throw invalid("This code isn't active yet");
  if (coupon.validTo && now > coupon.validTo) throw invalid("This code has expired");
  if (coupon.venueId && coupon.venueId !== input.venueId) throw invalid("This code can't be used at this venue");

  if (coupon.minAmount !== null && input.subtotal < Number(coupon.minAmount)) {
    throw invalid(`This code needs a booking of at least ₹${Number(coupon.minAmount)}`);
  }

  const counting = { couponId: coupon.id, status: { in: [...COUNTING_STATUSES] } };

  if (coupon.maxUses !== null) {
    const used = await client.booking.count({ where: counting });
    if (used >= coupon.maxUses) throw invalid("This code has been fully used");
  }

  if (coupon.perUserLimit !== null) {
    const usedByUser = await client.booking.count({ where: { ...counting, userId: input.userId } });
    if (usedByUser >= coupon.perUserLimit) {
      throw invalid(
        coupon.perUserLimit === 1 ? "You've already used this code" : `You can use this code ${coupon.perUserLimit} times`
      );
    }
  }

  const discount = computeDiscount(coupon, input.subtotal);
  if (discount <= 0) throw invalid("This code doesn't take anything off this booking");

  return { coupon, discount };
}

/** Serialises bookings that use the same code (released at the end of the transaction). */
export async function lockCoupon(tx: Tx, code: string) {
  const key = `coupon:${normalizeCouponCode(code)}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/** What the booking page shows after "Apply": the price with the discount. */
export async function previewCoupon(
  userId: string,
  input: { code: string; venueId: string; startTime: Date; endTime: Date }
) {
  await findPublicVenue(input.venueId);
  const quote = await quoteForVenue(input.venueId, input.startTime, input.endTime);
  const { coupon, discount } = await checkCoupon(prisma, {
    code: input.code,
    userId,
    venueId: input.venueId,
    subtotal: quote.total,
  });

  return {
    ...quote,
    subtotal: quote.total,
    discount,
    total: roundMoney(quote.total - discount),
    coupon: { code: coupon.code, description: coupon.description, type: coupon.type, value: Number(coupon.value) },
  };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface CouponInput {
  code: string;
  description?: string | null | undefined;
  type: CouponType;
  value: number;
  maxDiscount?: number | null | undefined;
  maxUses?: number | null | undefined;
  perUserLimit?: number | null | undefined;
  minAmount?: number | null | undefined;
  validFrom?: string | null | undefined;
  validTo?: string | null | undefined;
  venueId?: string | null | undefined;
  isActive?: boolean | undefined;
}

function couponData(input: Partial<CouponInput>) {
  const date = (value: string | null | undefined) => (value === undefined ? undefined : value === null ? null : new Date(value));

  const data = {
    code: input.code === undefined ? undefined : normalizeCouponCode(input.code),
    description: input.description,
    type: input.type,
    value: input.value,
    maxDiscount: input.maxDiscount,
    maxUses: input.maxUses,
    perUserLimit: input.perUserLimit,
    minAmount: input.minAmount,
    validFrom: date(input.validFrom),
    validTo: date(input.validTo),
    venueId: input.venueId,
    isActive: input.isActive,
  };

  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

function assertCouponRules(coupon: {
  type: CouponType;
  value: number;
  maxDiscount: number | null;
  validFrom: Date | null;
  validTo: Date | null;
}) {
  if (coupon.type === "PERCENT" && (coupon.value <= 0 || coupon.value > 100)) {
    throw new ValidationError("A percentage must be between 1 and 100", [{ field: "value", message: "1 to 100" }]);
  }
  if (coupon.type === "FLAT" && coupon.maxDiscount !== null) {
    throw new ValidationError("A cap only applies to percentage codes", [{ field: "maxDiscount", message: "Only for percentage codes" }]);
  }
  if (coupon.validFrom && coupon.validTo && coupon.validTo <= coupon.validFrom) {
    throw new ValidationError("The end must be after the start", [{ field: "validTo", message: "Must be after the start" }]);
  }
}

async function assertVenueExists(venueId: string | null | undefined) {
  if (venueId && !(await prisma.venue.findUnique({ where: { id: venueId }, select: { id: true } }))) {
    throw new ValidationError("Venue not found", [{ field: "venueId", message: "Venue not found" }]);
  }
}

const duplicateCode = (error: unknown) => {
  if (isUniqueViolation(error)) {
    throw new ConflictError("A coupon with this code already exists");
  }
  throw error;
};

export async function listCoupons(
  pagination: PaginationParams,
  filters: { q?: string | undefined; active?: boolean | undefined } = {}
) {
  const where: Prisma.CouponWhereInput = {
    ...(filters.q && { code: { contains: normalizeCouponCode(filters.q) } }),
    ...(filters.active !== undefined && { isActive: filters.active }),
  };

  const [coupons, total] = await prisma.$transaction([
    prisma.coupon.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.limit,
      include: { venue: { select: { id: true, name: true } } },
    }),
    prisma.coupon.count({ where }),
  ]);

  const usage = coupons.length
    ? await prisma.booking.groupBy({
        by: ["couponId"],
        where: { couponId: { in: coupons.map((c) => c.id) }, status: { in: [...COUNTING_STATUSES] } },
        _count: { _all: true },
        _sum: { discountAmount: true },
      })
    : [];
  const usageById = new Map(usage.map((row) => [row.couponId, row]));

  return {
    items: coupons.map((coupon) => ({
      ...coupon,
      uses: usageById.get(coupon.id)?._count._all ?? 0,
      totalDiscount: Number(usageById.get(coupon.id)?._sum.discountAmount ?? 0),
    })),
    pagination: buildPaginationMeta(pagination, total),
  };
}

export async function createCoupon(input: CouponInput, actorId: string) {
  const data = couponData(input) as unknown as Prisma.CouponUncheckedCreateInput;
  assertCouponRules({
    type: input.type,
    value: input.value,
    maxDiscount: input.maxDiscount ?? null,
    validFrom: (data.validFrom as Date | null | undefined) ?? null,
    validTo: (data.validTo as Date | null | undefined) ?? null,
  });
  await assertVenueExists(input.venueId);

  const coupon = await prisma.coupon.create({ data: { ...data, createdById: actorId } }).catch(duplicateCode);
  await recordAudit({ action: "coupon.created", entityType: "Coupon", entityId: coupon.id, after: coupon });
  return coupon;
}

export async function updateCoupon(id: string, input: Partial<CouponInput>) {
  const existing = await prisma.coupon.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Coupon not found");

  const data = couponData(input) as Prisma.CouponUncheckedUpdateInput;
  const merged = {
    type: (data.type as CouponType | undefined) ?? existing.type,
    value: input.value ?? Number(existing.value),
    maxDiscount: input.maxDiscount !== undefined ? input.maxDiscount : existing.maxDiscount === null ? null : Number(existing.maxDiscount),
    validFrom: data.validFrom !== undefined ? (data.validFrom as Date | null) : existing.validFrom,
    validTo: data.validTo !== undefined ? (data.validTo as Date | null) : existing.validTo,
  };
  assertCouponRules(merged);
  await assertVenueExists(input.venueId);

  const updated = await prisma.coupon.update({ where: { id }, data }).catch(duplicateCode);
  await recordAudit({ action: "coupon.updated", entityType: "Coupon", entityId: id, ...changedFields(existing, updated) });
  return updated;
}

/** Only codes that were never used can be deleted; used ones are switched off instead. */
export async function deleteCoupon(id: string) {
  const existing = await prisma.coupon.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Coupon not found");

  if ((await prisma.booking.count({ where: { couponId: id } })) > 0) {
    throw new ConflictError("This code has been used, so it can't be deleted. Switch it off instead.");
  }

  await prisma.coupon.delete({ where: { id } });
  await recordAudit({ action: "coupon.deleted", entityType: "Coupon", entityId: id, before: existing });
}
