import { Router, type Request, type Response } from "express";

import { authenticate } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { previewCoupon } from "../services/coupon.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { couponPreviewSchema } from "../validators/admin.schema.js";

const router = Router();

/**
 * @swagger
 * /coupons/preview:
 *   post:
 *     summary: Check a code for a booking the customer is about to make; returns the price with the discount
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ quote: { subtotal, discount, total, breakdown, coupon } }" }
 *       400: { description: "Code not valid here (message says why)" }
 */
router.post(
  "/preview",
  authenticate,
  validate(couponPreviewSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const quote = await previewCoupon(req.user!.id, {
      code: req.body.code,
      venueId: req.body.venueId,
      startTime: new Date(req.body.startTime),
      endTime: new Date(req.body.endTime),
    });
    res.json({ quote });
  })
);

export default router;
