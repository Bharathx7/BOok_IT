import { z } from "zod";

import { addDaysToKey, zonedTimeToUtc } from "../utils/datetime.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Money reports use India time, like the admin analytics. */
const REPORT_TIMEZONE = "Asia/Kolkata";

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (both days included) as UTC instants. */
export const moneyRangeSchema = z
  .object({
    from: z.string().regex(DATE, "Use YYYY-MM-DD"),
    to: z.string().regex(DATE, "Use YYYY-MM-DD"),
  })
  .refine((range) => range.from <= range.to, { message: "'from' must be on or before 'to'", path: ["to"] })
  .transform((range) => ({
    from: zonedTimeToUtc(range.from, "00:00", REPORT_TIMEZONE),
    to: zonedTimeToUtc(addDaysToKey(range.to, 1), "00:00", REPORT_TIMEZONE),
  }));

export const paymentListQuerySchema = z.object({
  status: z.enum(["CREATED", "AUTHORIZED", "CAPTURED", "FAILED", "PARTIALLY_REFUNDED", "REFUNDED"]).optional(),
  q: z.string().trim().max(100).optional(),
});

export const payoutSchema = z.object({
  providerId: z.string().uuid(),
  reference: z.string().trim().max(100).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});
