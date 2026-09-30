import { Router } from "express";
import {
  createReviewController,
  getVenueRatingController,
} from "../controllers/review.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../middleware/validate.middleware.js";
import { createReviewSchema, reportReviewSchema } from "../validators/review.schema.js";
import { reviewReplySchema } from "../validators/tools.schema.js";
import { authorize } from "../middleware/role.middleware.js";
import { replyToReview, reportReview } from "../services/review.service.js";
import type { Request, Response } from "express";

const router = Router();

/**
 * @swagger
 * /reviews:
 *   post:
 *     summary: Review a completed booking (once per booking)
 *     tags: [Reviews]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bookingId, rating]
 *             properties:
 *               bookingId: { type: string, format: uuid }
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               review: { type: string, maxLength: 2000 }
 *     responses:
 *       201: { description: Review }
 *       409: { description: Not completed yet, or already reviewed }
 * /reviews/{venueId}/rating:
 *   get:
 *     summary: Average rating and number of (visible) reviews for a venue
 *     tags: [Reviews]
 *     responses:
 *       200: { description: "{ averageRating, totalReviews }" }
 */
router.post(
  "/",
  authenticate,
  validate(createReviewSchema),
  asyncHandler(createReviewController)
);
router.get(
  "/:venueId/rating",
  asyncHandler(getVenueRatingController)
);

/**
 * @swagger
 * /reviews/{id}/reply:
 *   put:
 *     summary: Venue owner's public reply to a review (replaces any earlier reply)
 *     tags: [Reviews]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Reply saved }
 *       403: { description: Not the venue owner }
 *   delete:
 *     summary: Remove the reply
 *     tags: [Reviews]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Reply removed }
 */
router.put(
  "/:id/reply",
  authenticate,
  authorize("ADMIN", "PROVIDER"),
  validate(reviewReplySchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ review: await replyToReview(String(req.params.id), req.user!, req.body.reply) });
  })
);

/**
 * @swagger
 * /reviews/{id}/report:
 *   post:
 *     summary: Report a review to the admins (once per person; not your own)
 *     tags: [Reviews]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Reported }
 *       409: { description: Already reported }
 */
router.post(
  "/:id/report",
  authenticate,
  validate(reportReviewSchema),
  asyncHandler(async (req: Request, res: Response) => {
    await reportReview(String(req.params.id), req.user!.id, req.body.reason);
    res.status(204).end();
  })
);

router.delete(
  "/:id/reply",
  authenticate,
  authorize("ADMIN", "PROVIDER"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ review: await replyToReview(String(req.params.id), req.user!, null) });
  })
);

export default router;