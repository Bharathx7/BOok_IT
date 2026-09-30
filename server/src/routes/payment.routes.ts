import express, { Router, type Request, type Response } from "express";
import { z } from "zod";

import { env } from "../config/env.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { simulateCheckout } from "../payments/fake.js";
import { getGateway } from "../payments/gateway.js";
import { handleWebhook, paymentConfig, startPayment, verifyCheckout } from "../services/payment.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { NotFoundError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const router = Router();

const verifySchema = z.object({
  orderId: z.string().min(1).max(100),
  paymentId: z.string().min(1).max(100),
  signature: z.string().min(1).max(200),
});

const fakeCheckoutSchema = z.object({
  orderId: z.string().min(1).max(100),
  outcome: z.enum(["success", "failure"]),
});

/**
 * @swagger
 * /payments/config:
 *   get:
 *     summary: Whether online payments are on, and the public key the checkout needs
 *     tags: [Payments]
 *     responses:
 *       200: { description: "{ enabled, gateway, keyId, holdMinutes }" }
 */
router.get("/config", (_req, res) => {
  res.json(paymentConfig());
});

/**
 * @swagger
 * /payments/bookings/{id}/start:
 *   post:
 *     summary: The gateway order for an unpaid booking (created once, then reused), for the checkout
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "{ payment: { gateway, keyId, orderId, amountPaise, currency, expiresAt, ... } }" }
 *       409: { description: The booking doesn't need a payment, or its time to pay ran out }
 *       503: { description: The gateway is unavailable }
 */
router.post(
  "/bookings/:id/start",
  authenticate,
  authorize("USER"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ payment: await startPayment(String(req.params.id), req.user!.id) });
  })
);

/**
 * @swagger
 * /payments/verify:
 *   post:
 *     summary: Checks the result the checkout returned and, if paid, confirms the booking
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ booking }" }
 *       400: { description: The signature doesn't match }
 */
router.post(
  "/verify",
  authenticate,
  authorize("USER"),
  validate(verifySchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ booking: await verifyCheckout(req.user!.id, req.body) });
  })
);

/**
 * @swagger
 * /payments/fake/checkout:
 *   post:
 *     summary: "Development only (PAYMENT_GATEWAY=fake): pay or fail an order as a checkout would"
 *     tags: [Payments]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ orderId, paymentId, signature } - what the real checkout hands back" }
 *       404: { description: The fake gateway isn't in use }
 */
router.post(
  "/fake/checkout",
  authenticate,
  authorize("USER"),
  validate(fakeCheckoutSchema),
  asyncHandler(async (req: Request, res: Response) => {
    if (getGateway()?.name !== "fake" || env.NODE_ENV === "production") throw new NotFoundError();

    const result = simulateCheckout(req.body.orderId, req.body.outcome);
    // Like the real gateway, the webhook arrives separately, a moment later.
    setTimeout(() => {
      handleWebhook(result.webhook.body, result.webhook.signature, result.webhook.eventId).catch((error: unknown) =>
        logger.error({ err: error }, "Fake webhook failed")
      );
    }, 1500).unref();

    res.json({ orderId: req.body.orderId, paymentId: result.paymentId, signature: result.signature });
  })
);

export default router;

/**
 * The gateway's webhook. Mounted before the JSON body parser: the signature
 * is checked against the exact bytes received.
 *
 * @swagger
 * /payments/webhook:
 *   post:
 *     summary: Payment gateway webhook (Razorpay). Signed; repeated deliveries are processed once
 *     tags: [Payments]
 *     responses:
 *       200: { description: Accepted }
 *       400: { description: Bad signature }
 */
export const webhookRouter = Router();

webhookRouter.post(
  "/",
  express.raw({ type: "*/*", limit: "1mb" }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const result = await handleWebhook(body, req.get("x-razorpay-signature"), req.get("x-razorpay-event-id"));
    res.json({ ok: true, ...result });
  })
);
