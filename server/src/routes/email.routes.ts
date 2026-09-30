import { Router } from "express";
import { z } from "zod";

import { sendTestEmail } from "../services/email.service.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const testEmailSchema = z.object({
  to: z.string().email("Invalid recipient email"),
});

/**
 * Admin-only SMTP check. Previously public, which let anyone send mail
 * through the server's account.
 */
/**
 * @swagger
 * /email/test:
 *   post:
 *     summary: Send a test email (admins only)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sent }
 */
router.post(
  "/test",
  authenticate,
  authorize("ADMIN"),
  validate(testEmailSchema),
  asyncHandler(async (req, res) => {
    await sendTestEmail(req.body.to);

    return res.status(200).json({
      message: "Test email sent successfully",
    });
  })
);

export default router;
