import { Router } from "express";

import {
  forgotPasswordController,
  loginController,
  logoutAllController,
  logoutController,
  refreshTokenController,
  registerController,
  resendVerificationController,
  resetPasswordController,
  verifyEmailController,
} from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authRateLimiter } from "../middleware/rateLimit.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "../validators/auth.schema.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// The strict rate limit applies to endpoints that take credentials or send
// email. /refresh and /logout run on every page load and are covered by the
// global limit only.

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new customer and send a verification email
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, example: Test User }
 *               email: { type: string, format: email, example: test@example.com }
 *               password: { type: string, format: password, example: Password123 }
 *     responses:
 *       201: { description: User registered }
 *       400: { description: Validation failed }
 *       409: { description: Email already registered }
 */
router.post(
  "/register",
  authRateLimiter,
  validate(registerSchema),
  asyncHandler(registerController)
);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Sign in. Returns the user and an access token, and sets the refresh-token cookie
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: test@example.com }
 *               password: { type: string, format: password, example: Password123 }
 *     responses:
 *       200: { description: Signed in }
 *       401: { description: Invalid credentials }
 *       403: { description: Account suspended or banned }
 */
router.post(
  "/login",
  authRateLimiter,
  validate(loginSchema),
  asyncHandler(loginController)
);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Rotate the refresh-token cookie and get a new access token
 *     tags: [Authentication]
 *     responses:
 *       200: { description: New access token and current user }
 *       204: { description: No session cookie (signed out) }
 *       401: { description: Expired or revoked session }
 */
router.post("/refresh", asyncHandler(refreshTokenController));

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Sign out this device (revokes the refresh token)
 *     tags: [Authentication]
 *     responses:
 *       204: { description: Signed out }
 */
router.post("/logout", asyncHandler(logoutController));

/**
 * @swagger
 * /auth/logout-all:
 *   post:
 *     summary: Sign out on every device
 *     tags: [Authentication]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: All sessions revoked }
 */
router.post("/logout-all", authenticate, asyncHandler(logoutAllController));

/**
 * @swagger
 * /auth/verify-email:
 *   post:
 *     summary: Confirm an email address with the token from the verification email
 *     tags: [Authentication]
 *     responses:
 *       200: { description: Email verified }
 *       400: { description: Invalid or expired link }
 */
router.post(
  "/verify-email",
  authRateLimiter,
  validate(verifyEmailSchema),
  asyncHandler(verifyEmailController)
);

/**
 * @swagger
 * /auth/resend-verification:
 *   post:
 *     summary: Send a new verification email to the signed-in user
 *     tags: [Authentication]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Sent }
 *       409: { description: Already verified }
 */
router.post(
  "/resend-verification",
  authRateLimiter,
  authenticate,
  asyncHandler(resendVerificationController)
);

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Email a password reset link (same response whether or not the account exists)
 *     tags: [Authentication]
 *     responses:
 *       200: { description: Request accepted }
 */
router.post(
  "/forgot-password",
  authRateLimiter,
  validate(forgotPasswordSchema),
  asyncHandler(forgotPasswordController)
);

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Set a new password using the reset link token; signs out all devices
 *     tags: [Authentication]
 *     responses:
 *       200: { description: Password updated }
 *       400: { description: Invalid or expired link, or weak password }
 */
router.post(
  "/reset-password",
  authRateLimiter,
  validate(resetPasswordSchema),
  asyncHandler(resetPasswordController)
);

export default router;
