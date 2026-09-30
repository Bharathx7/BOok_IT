import { Router } from "express";

import {
  changePasswordController,
  getMeController,
  updateMeController,
} from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authRateLimiter } from "../middleware/rateLimit.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { changePasswordSchema, updateProfileSchema } from "../validators/auth.schema.js";
import { getFavoritesController } from "../controllers/venue.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.use(authenticate);

/**
 * @swagger
 * /users/me:
 *   get:
 *     summary: Current user's profile
 *     tags: [Account]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Profile }
 *   patch:
 *     summary: Update name, phone or avatar URL (empty string clears phone/avatar)
 *     tags: [Account]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated profile }
 *       400: { description: Validation failed }
 */
router.get("/me", asyncHandler(getMeController));
router.patch("/me", validate(updateProfileSchema), asyncHandler(updateMeController));

/**
 * @swagger
 * /users/me/favorites:
 *   get:
 *     summary: The signed-in user's favourite venues, most recently saved first
 *     tags: [Account]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Page of venue summaries }
 */
router.get("/me/favorites", asyncHandler(getFavoritesController));

/**
 * @swagger
 * /users/me/password:
 *   post:
 *     summary: Change password; signs out other devices and returns a fresh session for this one
 *     tags: [Account]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Password changed }
 *       400: { description: Wrong current password or weak new password }
 */
router.post(
  "/me/password",
  authRateLimiter,
  validate(changePasswordSchema),
  asyncHandler(changePasswordController)
);

export default router;
