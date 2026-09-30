import { Router } from "express";

import {
  createTimeSlotController,
  getVenueTimeSlotsController,
  deleteTimeSlotController,
  checkAvailabilityController,
  updateTimeSlotController,
} from "../controllers/timeslot.controller.js";

import { authenticate, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createTimeSlotSchema, updateTimeSlotSchema } from "../validators/timeslot.schema.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

/**
 * @swagger
 * /timeslots:
 *   post:
 *     summary: Add an opening window to a venue (owner or admin; can't overlap another window)
 *     tags: [Time slots]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [venueId, startTime, endTime]
 *             properties:
 *               venueId: { type: string, format: uuid }
 *               startTime: { type: string, format: date-time }
 *               endTime: { type: string, format: date-time }
 *     responses:
 *       201: { description: Created }
 *       409: { description: Overlaps an existing window }
 * /timeslots/venue/{venueId}:
 *   get:
 *     summary: A venue's opening windows
 *     tags: [Time slots]
 *     parameters:
 *       - { in: path, name: venueId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Time slots }
 * /timeslots/venue/{venueId}/availability:
 *   get:
 *     summary: Whether a time range is inside an opening window and free
 *     tags: [Time slots]
 *     parameters:
 *       - { in: path, name: venueId, required: true, schema: { type: string } }
 *       - { in: query, name: startTime, required: true, schema: { type: string, format: date-time } }
 *       - { in: query, name: endTime, required: true, schema: { type: string, format: date-time } }
 *     responses:
 *       200: { description: Availability }
 * /timeslots/{id}:
 *   put:
 *     summary: Change an opening window's times
 *     tags: [Time slots]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated }
 *   delete:
 *     summary: Remove an opening window
 *     tags: [Time slots]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Deleted }
 */
router.post(
  "/",
  authenticate,
  authorize("ADMIN", "PROVIDER"),
  requireVerifiedEmail,
  validate(createTimeSlotSchema),
  asyncHandler(createTimeSlotController)
);

router.get(
  "/venue/:venueId",
  asyncHandler(getVenueTimeSlotsController)
);

router.put(
  "/:id",
  authenticate,
  authorize("ADMIN", "PROVIDER"),
  validate(updateTimeSlotSchema),
  asyncHandler(updateTimeSlotController)
);

router.delete(
  "/:id",
  authenticate,
  authorize("ADMIN", "PROVIDER"),
  asyncHandler(deleteTimeSlotController)
);

router.get(
  "/venue/:venueId/availability",
  asyncHandler(checkAvailabilityController)
);

export default router;