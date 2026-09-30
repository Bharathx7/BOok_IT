import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const userListQuerySchema = z.object({
  role: z.enum(["USER", "PROVIDER", "ADMIN"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]).optional(),
  q: optionalText(100),
});

export const venueListQuerySchema = z.object({
  approvalStatus: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  q: optionalText(100),
});

export const bookingListQuerySchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "EXPIRED"]).optional(),
  venueId: z.string().uuid().optional(),
  q: optionalText(100),
});

export const reviewListQuerySchema = z.object({
  status: z.enum(["VISIBLE", "FLAGGED", "HIDDEN"]).optional(),
  venueId: z.string().uuid().optional(),
});

export const userStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]),
  reason: z.string().trim().max(500).optional().nullable(),
});

export const venueReviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().max(1000).optional().nullable(),
});

export const moderateReviewSchema = z.object({
  status: z.enum(["HIDDEN", "VISIBLE"]),
  note: z.string().trim().max(500).optional().nullable(),
});

const money = z.number().positive().max(1_000_000);
const count = z.number().int().min(1).max(1_000_000);
const instant = z.string().datetime({ offset: true });

const couponFields = {
  code: z
    .string()
    .trim()
    .min(3, "At least 3 characters")
    .max(30, "At most 30 characters")
    .regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only"),
  description: z.string().trim().max(200).nullable().optional(),
  type: z.enum(["PERCENT", "FLAT"]),
  value: money,
  maxDiscount: money.nullable().optional(),
  maxUses: count.nullable().optional(),
  perUserLimit: count.nullable().optional(),
  minAmount: money.nullable().optional(),
  validFrom: instant.nullable().optional(),
  validTo: instant.nullable().optional(),
  venueId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
};

export const createCouponSchema = z.object(couponFields);
export const updateCouponSchema = z.object(couponFields).partial();

export const couponListQuerySchema = z.object({
  q: optionalText(30),
  active: z.enum(["true", "false"]).optional().transform((value) => (value === undefined ? undefined : value === "true")),
});

export const couponPreviewSchema = z.object({
  code: z.string().trim().min(1, "Enter a code").max(40),
  venueId: z.string().uuid(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
});

export const auditQuerySchema = z.object({
  actorId: z.string().uuid().optional(),
  action: optionalText(100),
  entityType: optionalText(50),
  entityId: optionalText(100),
  from: dateKey.optional(),
  to: dateKey.optional(),
});

export const platformAnalyticsQuerySchema = z.object({
  from: dateKey,
  to: dateKey,
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, "Type at least 2 characters").max(100),
});

export const settingsUpdateSchema = z.record(z.string(), z.unknown());
