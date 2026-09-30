import { Router, type Request, type Response } from "express";

import { authenticate, optionalAuthenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { quoteForVenue } from "../services/pricing.service.js";
import {
  assertVenueManager,
  createBlackout,
  createPricingRule,
  createTemplate,
  deleteBlackout,
  deletePricingRule,
  deleteTemplate,
  generateSlots,
  getDaySchedule,
  listBlackouts,
  listPricingRules,
  listTemplates,
  updatePricingRule,
  updateTemplate,
} from "../services/venueTools.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ValidationError } from "../utils/errors.js";
import {
  createBlackoutSchema,
  createPricingRuleSchema,
  createTemplateSchema,
  dateQuerySchema,
  generateSlotsSchema,
  quoteQuerySchema,
  updatePricingRuleSchema,
  updateTemplateSchema,
} from "../validators/tools.schema.js";

// Mounted at /api/venues/:id - scheduling and pricing tools for one venue.
const router = Router({ mergeParams: true });

const param = (req: Request, name: string) => {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) throw new ValidationError(`Invalid ${name}`);
  return value;
};

/** Loads the venue and checks the signed-in user may manage it. */
const managedVenueId = async (req: Request) => {
  const venueId = param(req, "id");
  await assertVenueManager(venueId, req.user!.id, req.user!.role === "ADMIN");
  return venueId;
};

const manage = [authenticate, authorize("ADMIN", "PROVIDER")] as const;

/**
 * @swagger
 * /venues/{id}/schedule:
 *   get:
 *     summary: Opening windows and busy periods for one day (booking page)
 *     tags: [Venue tools]
 *     parameters:
 *       - { in: query, name: date, required: true, schema: { type: string, example: "2026-10-03" } }
 *     responses:
 *       200: { description: "Windows, busy periods (no personal data), slotMinutes, maxBookingMinutes" }
 * /venues/{id}/quote:
 *   get:
 *     summary: Price for a time range, with a breakdown by pricing rule
 *     tags: [Venue tools]
 *     parameters:
 *       - { in: query, name: startTime, required: true, schema: { type: string, format: date-time } }
 *       - { in: query, name: endTime, required: true, schema: { type: string, format: date-time } }
 *     responses:
 *       200: { description: "{ total, basePricePerHour, breakdown }" }
 */
router.get(
  "/schedule",
  optionalAuthenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { date } = dateQuerySchema.parse(req.query);
    res.json({ schedule: await getDaySchedule(param(req, "id"), date, req.user) });
  })
);

router.get(
  "/quote",
  asyncHandler(async (req: Request, res: Response) => {
    const { startTime, endTime } = quoteQuerySchema.parse(req.query);
    res.json({ quote: await quoteForVenue(param(req, "id"), new Date(startTime), new Date(endTime)) });
  })
);

/**
 * @swagger
 * /venues/{id}/templates:
 *   get:
 *     summary: Slot templates (repeating opening hours)
 *     tags: [Venue tools]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Templates }
 *   post:
 *     summary: Create a slot template, e.g. Mon-Fri 06:00-23:00
 *     tags: [Venue tools]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 * /venues/{id}/templates/{templateId}:
 *   put:
 *     summary: Update a template (future generation only)
 *     tags: [Venue tools]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated }
 *   delete:
 *     summary: Delete a template; ?removeFutureSlots=true also deletes its future slots
 *     tags: [Venue tools]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ removedSlots }" }
 * /venues/{id}/templates/generate:
 *   post:
 *     summary: Create slots from templates for the next N days (dryRun to preview); days with an overlapping slot are skipped
 *     tags: [Venue tools]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ created, planned, skipped }" }
 */
router.get(
  "/templates",
  ...manage,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ templates: await listTemplates(await managedVenueId(req)) });
  })
);

router.post(
  "/templates",
  ...manage,
  validate(createTemplateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json({ template: await createTemplate(await managedVenueId(req), req.body) });
  })
);

router.post(
  "/templates/generate",
  ...manage,
  validate(generateSlotsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await generateSlots(await managedVenueId(req), req.body));
  })
);

router.put(
  "/templates/:templateId",
  ...manage,
  validate(updateTemplateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const venueId = await managedVenueId(req);
    res.json({ template: await updateTemplate(venueId, param(req, "templateId"), req.body) });
  })
);

router.delete(
  "/templates/:templateId",
  ...manage,
  asyncHandler(async (req: Request, res: Response) => {
    const venueId = await managedVenueId(req);
    res.json(await deleteTemplate(venueId, param(req, "templateId"), req.query.removeFutureSlots === "true"));
  })
);

/**
 * @swagger
 * /venues/{id}/blackouts:
 *   get:
 *     summary: Upcoming closures (?includePast=true for all)
 *     tags: [Venue tools]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Blackouts }
 *   post:
 *     summary: Close the venue for a period; returns how many existing bookings overlap it
 *     tags: [Venue tools]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "{ blackout, affectedBookings }" }
 * /venues/{id}/blackouts/{blackoutId}:
 *   delete:
 *     summary: Remove a closure
 *     tags: [Venue tools]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Removed }
 */
router.get(
  "/blackouts",
  ...manage,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ blackouts: await listBlackouts(await managedVenueId(req), req.query.includePast === "true") });
  })
);

router.post(
  "/blackouts",
  ...manage,
  validate(createBlackoutSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await createBlackout(await managedVenueId(req), {
      startTime: new Date(req.body.startTime),
      endTime: new Date(req.body.endTime),
      reason: req.body.reason,
    });
    res.status(201).json(result);
  })
);

router.delete(
  "/blackouts/:blackoutId",
  ...manage,
  asyncHandler(async (req: Request, res: Response) => {
    await deleteBlackout(await managedVenueId(req), param(req, "blackoutId"));
    res.status(204).end();
  })
);

/**
 * @swagger
 * /venues/{id}/pricing-rules:
 *   get:
 *     summary: Pricing rules, highest priority first
 *     tags: [Venue tools]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Rules }
 *   post:
 *     summary: "Add a rule: FIXED rupees per hour or MULTIPLIER of the base price, for certain days/times"
 *     tags: [Venue tools]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Created }
 * /venues/{id}/pricing-rules/{ruleId}:
 *   put:
 *     summary: Update a rule
 *     tags: [Venue tools]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated }
 *   delete:
 *     summary: Delete a rule
 *     tags: [Venue tools]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Deleted }
 */
router.get(
  "/pricing-rules",
  ...manage,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ rules: await listPricingRules(await managedVenueId(req)) });
  })
);

router.post(
  "/pricing-rules",
  ...manage,
  validate(createPricingRuleSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json({ rule: await createPricingRule(await managedVenueId(req), req.body) });
  })
);

router.put(
  "/pricing-rules/:ruleId",
  ...manage,
  validate(updatePricingRuleSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const venueId = await managedVenueId(req);
    res.json({ rule: await updatePricingRule(venueId, param(req, "ruleId"), req.body) });
  })
);

router.delete(
  "/pricing-rules/:ruleId",
  ...manage,
  asyncHandler(async (req: Request, res: Response) => {
    await deletePricingRule(await managedVenueId(req), param(req, "ruleId"));
    res.status(204).end();
  })
);

export default router;
