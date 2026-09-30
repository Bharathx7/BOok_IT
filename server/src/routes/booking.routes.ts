import { Router } from "express";

import {
  createBookingController,
  getUserBookingsController,
  getBookingByIdController,
  getProviderBookingsController,
  cancelBookingController,
  confirmBookingController,
  completeBookingController,
} from "../controllers/booking.controller.js";

import { authenticate, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createBookingSchema } from "../validators/booking.schema.js";
import { manualBookingSchema } from "../validators/tools.schema.js";
import { createManualBooking, getCancellationQuote } from "../services/booking.service.js";
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

/**
 * @swagger
 * /bookings:
 *   post:
 *     summary: Create a new booking
 *     tags:
 *       - Bookings
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - venueId
 *               - startTime
 *               - endTime
 *             properties:
 *               venueId:
 *                 type: string
 *                 example: "2f21dd92-beec-4a71-9ba5-1b44f13e4ba2"
 *               startTime:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-08-16T10:00:00.000Z"
 *               endTime:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-08-16T11:00:00.000Z"
 *               couponCode:
 *                 type: string
 *                 example: "WEEKEND20"
 *                 description: Optional discount code (checked again when booking)
 *     responses:
 *       201:
 *         description: Booking created successfully
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Unauthorized
 */

router.post(
  "/",
  authenticate,
  requireVerifiedEmail,
  validate(createBookingSchema),
  asyncHandler(createBookingController)
);

/**
 * Get bookings created by the logged-in customer
 */
/**
 * @swagger
 * /bookings:
 *   get:
 *     summary: The signed-in customer's bookings, newest first
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema: { type: string, enum: [upcoming, past] }
 *         description: "upcoming: active bookings that haven't ended, soonest first. past: the rest, latest first."
 *     responses:
 *       200: { description: Page of bookings }
 * /bookings/provider:
 *   get:
 *     summary: Bookings at the signed-in provider's venues
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema: { type: string, enum: [upcoming, past, pending] }
 *         description: "upcoming: soonest first. past: latest first. pending: requests awaiting confirmation, most urgent first."
 *     responses:
 *       200: { description: Page of bookings with customer details }
 * /bookings/{id}:
 *   get:
 *     summary: One of the customer's own bookings
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Booking }
 *       404: { description: Not found }
 * /bookings/{id}/cancel:
 *   patch:
 *     summary: Cancel (customer, venue owner or admin); the venue's policy sets the refund
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Cancelled booking with refundPercent and refundAmount }
 *       409: { description: Already cancelled, completed or expired }
 * /bookings/{id}/confirm:
 *   patch:
 *     summary: Confirm a pending request (venue owner or admin) while it hasn't expired
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Confirmed booking }
 *       409: { description: Not pending, or expired }
 * /bookings/{id}/complete:
 *   patch:
 *     summary: Mark a confirmed booking as played (venue owner or admin)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Completed booking }
 */
router.get(
  "/",
  authenticate,
  asyncHandler(getUserBookingsController)
);

/**
 * Get bookings for venues owned by the logged-in provider
 *
 * IMPORTANT:
 * This route must come before /:id
 */
router.get(
  "/provider",
  authenticate,
  authorize("PROVIDER"),
  asyncHandler(getProviderBookingsController)
);

/**
 * Get a specific booking
 */
/**
 * @swagger
 * /bookings/manual:
 *   post:
 *     summary: "Venue owner adds a walk-in booking or blocks time (kind: WALK_IN | BLOCK); confirmed immediately"
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Booking }
 *       409: { description: Overlaps another booking }
 */
router.post(
  "/manual",
  authenticate,
  authorize("ADMIN", "PROVIDER"),
  validate(manualBookingSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const booking = await createManualBooking(req.user!, {
      ...req.body,
      startTime: new Date(req.body.startTime),
      endTime: new Date(req.body.endTime),
    });
    res.status(201).json({ booking });
  })
);

/**
 * @swagger
 * /bookings/{id}/cancellation-quote:
 *   get:
 *     summary: What cancelling now would refund under the venue's policy
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ refundPercent, refundAmount, hoursBeforeStart, reason }" }
 */
router.get(
  "/:id/cancellation-quote",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ quote: await getCancellationQuote(String(req.params.id), req.user!.id, req.user!.role) });
  })
);

router.get(
  "/:id",
  authenticate,
  asyncHandler(getBookingByIdController)
);

/**
 * Cancel booking
 *
 * Currently handled by the booking owner.
 */
router.patch(
  "/:id/cancel",
  authenticate,
  authorize("USER", "PROVIDER", "ADMIN"),
  asyncHandler(cancelBookingController)
);

/**
 * Confirm booking
 *
 * ADMIN can confirm any booking.
 * PROVIDER can confirm only their own venue's booking.
 *
 * Ownership is checked inside the service.
 */
router.patch(
  "/:id/confirm",
  authenticate,
  authorize("ADMIN", "PROVIDER"),
  asyncHandler(confirmBookingController)
);

/**
 * Complete booking
 *
 * ADMIN can complete any booking.
 * PROVIDER can complete only their own venue's booking.
 *
 * Ownership is checked inside the service.
 */
router.patch(
  "/:id/complete",
  authenticate,
  authorize("ADMIN", "PROVIDER"),
  asyncHandler(completeBookingController)
);

export default router;