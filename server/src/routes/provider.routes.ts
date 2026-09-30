import { Router, type Request, type Response } from "express";

import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import {
  exportBookingsCsv,
  getProviderAnalytics,
  getProviderCalendar,
} from "../services/providerAnalytics.service.js";
import { z } from "zod";
import { listProviderReviews } from "../services/review.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { parsePagination } from "../utils/pagination.js";
import { analyticsQuerySchema } from "../validators/tools.schema.js";
import { getProviderEarnings } from "../services/earnings.service.js";
import { moneyRangeSchema } from "../validators/payment.schema.js";

// Reports and lists across all of the signed-in provider's venues.
const router = Router();

router.use(authenticate, authorize("PROVIDER"));

/**
 * @swagger
 * /provider/analytics:
 *   get:
 *     summary: Revenue, occupancy, weekday x hour heatmap, top customers, cancellation rate and rating trend
 *     tags: [Provider]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, required: true, schema: { type: string, example: "2026-09-01" } }
 *       - { in: query, name: to, required: true, schema: { type: string, example: "2026-09-30" } }
 *       - { in: query, name: venueId, schema: { type: string } }
 *     responses:
 *       200: { description: Report }
 */
/**
 * @swagger
 * /provider/earnings:
 *   get:
 *     summary: Online payments for the provider's venues - totals, what's still to be paid out, entries (paise)
 *     tags: [Provider]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, required: true, schema: { type: string, example: "2026-09-01" } }
 *       - { in: query, name: to, required: true, schema: { type: string, example: "2026-09-30" } }
 *     responses:
 *       200: { description: "{ period, sales, refunds, unpaid, payouts, entries, pagination }" }
 */
router.get(
  "/earnings",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await getProviderEarnings(req.user!.id, moneyRangeSchema.parse(req.query), parsePagination(req.query)));
  })
);

router.get(
  "/analytics",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await getProviderAnalytics(req.user!.id, analyticsQuerySchema.parse(req.query)));
  })
);

/**
 * @swagger
 * /provider/bookings/export:
 *   get:
 *     summary: Bookings starting in the range as CSV (Excel-friendly, formulas neutralised)
 *     tags: [Provider]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, required: true, schema: { type: string } }
 *       - { in: query, name: to, required: true, schema: { type: string } }
 *       - { in: query, name: venueId, schema: { type: string } }
 *     responses:
 *       200: { description: text/csv attachment }
 */
router.get(
  "/bookings/export",
  asyncHandler(async (req: Request, res: Response) => {
    const range = analyticsQuerySchema.parse(req.query);
    const csv = await exportBookingsCsv(req.user!.id, range);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="bookit-bookings-${range.from}-to-${range.to}.csv"`);
    res.send(csv);
  })
);

/**
 * @swagger
 * /provider/reviews:
 *   get:
 *     summary: Reviews of the provider's venues (?unanswered=true, ?venueId=)
 *     tags: [Provider]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Page of reviews }
 */
router.get(
  "/reviews",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      await listProviderReviews(req.user!.id, parsePagination(req.query), {
        venueId: typeof req.query.venueId === "string" ? req.query.venueId : undefined,
        unanswered: req.query.unanswered === "true",
      })
    );
  })
);

const calendarQuerySchema = z.object({
  venueId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * @swagger
 * /provider/calendar:
 *   get:
 *     summary: One venue's slots, bookings (with customer details) and closures for up to 31 days
 *     tags: [Provider]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: venueId, required: true, schema: { type: string } }
 *       - { in: query, name: from, required: true, schema: { type: string } }
 *       - { in: query, name: to, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Calendar data }
 */
router.get(
  "/calendar",
  asyncHandler(async (req: Request, res: Response) => {
    const { venueId, from, to } = calendarQuerySchema.parse(req.query);
    res.json(await getProviderCalendar(req.user!.id, venueId, from, to));
  })
);

export default router;
