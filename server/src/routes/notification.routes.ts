import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authenticate } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  countUnread,
  getPreferences,
  listNotifications,
  markAllRead,
  markRead,
  updatePreferences,
} from "../services/notification.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ValidationError } from "../utils/errors.js";
import { parsePagination } from "../utils/pagination.js";

const router = Router();

router.use(authenticate);

const preferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        type: z.enum(NOTIFICATION_TYPES as [string, ...string[]]),
        channel: z.enum(NOTIFICATION_CHANNELS as [string, ...string[]]),
        enabled: z.boolean(),
      })
    )
    .min(1)
    .max(NOTIFICATION_TYPES.length * NOTIFICATION_CHANNELS.length),
});

const idSchema = z.string().uuid("Invalid notification id");

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: The signed-in user's notifications, newest first, with the unread count
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *       - { in: query, name: unread, schema: { type: boolean }, description: Only unread ones }
 *     responses:
 *       200: { description: Page of notifications }
 */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const unreadOnly = req.query.unread === "true";
    res.json(await listNotifications(req.user!.id, parsePagination(req.query), unreadOnly));
  })
);

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     summary: Number of unread notifications (for the bell badge)
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ unreadCount }" }
 */
router.get(
  "/unread-count",
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ unreadCount: await countUnread(req.user!.id) });
  })
);

/**
 * @swagger
 * /notifications/read-all:
 *   post:
 *     summary: Mark every notification as read
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ updated }" }
 */
router.post(
  "/read-all",
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ updated: await markAllRead(req.user!.id) });
  })
);

/**
 * @swagger
 * /notifications/preferences:
 *   get:
 *     summary: Which notification types arrive in-app and by email
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Full type x channel matrix }
 *   put:
 *     summary: Turn notification types on or off per channel
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated matrix }
 */
router.get(
  "/preferences",
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ preferences: await getPreferences(req.user!.id) });
  })
);

router.put(
  "/preferences",
  validate(preferencesSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { preferences } = req.body as z.infer<typeof preferencesSchema>;
    res.json({
      preferences: await updatePreferences(
        req.user!.id,
        preferences as Parameters<typeof updatePreferences>[1]
      ),
    });
  })
);

/**
 * @swagger
 * /notifications/{id}/read:
 *   patch:
 *     summary: Mark one notification as read
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated notification }
 *       404: { description: Not found }
 */
router.patch(
  "/:id/read",
  asyncHandler(async (req: Request, res: Response) => {
    const id = idSchema.safeParse(req.params.id);

    if (!id.success) {
      throw new ValidationError("Invalid notification id");
    }

    res.json({ notification: await markRead(req.user!.id, id.data) });
  })
);

export default router;
