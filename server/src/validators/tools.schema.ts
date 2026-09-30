import { z } from "zod";

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const HH_MM_OR_24 = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const dateString = z
  .string()
  .regex(DATE, "Use YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Invalid date");

const weekdays = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .transform((days) => [...new Set(days)].sort());

const validity = <T extends { validFrom?: string | null | undefined; validTo?: string | null | undefined }>(data: T) =>
  !data.validFrom || !data.validTo || data.validFrom <= data.validTo;

const validityMessage = { message: "The start date must be on or before the end date", path: ["validTo"] };

// Slot templates

const templateFields = {
  name: z.string().trim().max(60).nullable().optional(),
  daysOfWeek: weekdays.refine((days) => days.length > 0, "Pick at least one day"),
  startTime: z.string().regex(HH_MM, "Use HH:mm"),
  endTime: z.string().regex(HH_MM_OR_24, "Use HH:mm"),
  validFrom: dateString.nullable().optional(),
  validTo: dateString.nullable().optional(),
  isActive: z.boolean().optional(),
};

const templateTimesOk = (data: { startTime?: string | undefined; endTime?: string | undefined }) =>
  !data.startTime || !data.endTime || data.startTime < data.endTime || data.endTime === "24:00";

const templateTimesMessage = { message: "Closing time must be after opening time", path: ["endTime"] };

export const createTemplateSchema = z
  .object(templateFields)
  .strict()
  .refine(templateTimesOk, templateTimesMessage)
  .refine(validity, validityMessage);

export const updateTemplateSchema = z
  .object(templateFields)
  .partial()
  .strict()
  .refine(templateTimesOk, templateTimesMessage)
  .refine(validity, validityMessage);

export const generateSlotsSchema = z
  .object({
    days: z.number().int().min(1).max(90).default(30),
    fromDate: dateString.optional(),
    templateIds: z.array(z.string().uuid()).max(50).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

// Blackouts

export const createBlackoutSchema = z
  .object({
    startTime: z.string().datetime("Invalid start time"),
    endTime: z.string().datetime("Invalid end time"),
    reason: z.string().trim().max(200).nullable().optional(),
  })
  .strict()
  .refine((data) => data.startTime < data.endTime, {
    message: "The end must be after the start",
    path: ["endTime"],
  });

// Pricing rules

const ruleFields = {
  name: z.string().trim().min(1, "Give the rule a name").max(60),
  daysOfWeek: weekdays.optional(),
  startTime: z.string().regex(HH_MM, "Use HH:mm"),
  endTime: z.string().regex(HH_MM_OR_24, "Use HH:mm"),
  validFrom: dateString.nullable().optional(),
  validTo: dateString.nullable().optional(),
  type: z.enum(["FIXED", "MULTIPLIER"]),
  value: z.number().positive("Must be more than 0").max(1_000_000),
  priority: z.number().int().min(-100).max(100).optional(),
  isActive: z.boolean().optional(),
};

const ruleValueOk = (data: { type?: "FIXED" | "MULTIPLIER" | undefined; value?: number | undefined }) =>
  data.type !== "MULTIPLIER" || data.value === undefined || data.value <= 10;

const ruleValueMessage = { message: "A multiplier can be at most 10x", path: ["value"] };

export const createPricingRuleSchema = z
  .object(ruleFields)
  .strict()
  .refine((data) => data.startTime !== data.endTime, { message: "Start and end can't be the same", path: ["endTime"] })
  .refine(ruleValueOk, ruleValueMessage)
  .refine(validity, validityMessage);

export const updatePricingRuleSchema = z
  .object(ruleFields)
  .partial()
  .strict()
  .refine(ruleValueOk, ruleValueMessage)
  .refine(validity, validityMessage);

// Query strings

export const dateQuerySchema = z.object({ date: dateString });

export const quoteQuerySchema = z
  .object({
    startTime: z.string().datetime("Invalid start time"),
    endTime: z.string().datetime("Invalid end time"),
  })
  .refine((data) => data.startTime < data.endTime, { message: "The end must be after the start", path: ["endTime"] });

export const analyticsQuerySchema = z
  .object({
    from: dateString,
    to: dateString,
    venueId: z.string().uuid().optional(),
  })
  .refine((data) => data.from <= data.to, { message: "'from' must be on or before 'to'", path: ["to"] });

// Bookings entered by the owner

export const manualBookingSchema = z
  .object({
    venueId: z.string().uuid("Invalid venue ID"),
    startTime: z.string().datetime("Invalid start time"),
    endTime: z.string().datetime("Invalid end time"),
    kind: z.enum(["WALK_IN", "BLOCK"]),
    guestName: z.string().trim().max(100).nullable().optional(),
    guestPhone: z.string().trim().max(30).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    price: z.number().min(0).max(1_000_000).optional(),
  })
  .strict()
  .refine((data) => data.startTime < data.endTime, { message: "The end must be after the start", path: ["endTime"] })
  .refine((data) => data.kind === "BLOCK" || Boolean(data.guestName), {
    message: "Enter the customer's name for a walk-in",
    path: ["guestName"],
  });

// Review replies

export const reviewReplySchema = z
  .object({
    reply: z.string().trim().min(1, "Write a reply").max(1000, "Keep replies under 1000 characters"),
  })
  .strict();
