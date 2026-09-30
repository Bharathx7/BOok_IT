import { Router, type Request, type Response } from "express";

import {
  getAdminDashboardController,
  getAdminBookingsController,
  getAdminUsersController,
  getAdminVenuesController,
} from "../controllers/admin.controller.js";

import { authenticate } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  adminSearch,
  getAdminUserDetail,
  getPlatformAnalytics,
  reviewVenue,
  setUserStatus,
} from "../services/admin.service.js";
import { listAuditActions, listAuditLogs } from "../services/audit.service.js";
import { createCoupon, deleteCoupon, listCoupons, updateCoupon } from "../services/coupon.service.js";
import { listReviewsForModeration, moderateReview } from "../services/review.service.js";
import { describeSettings, updateSettings } from "../services/settings.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { DEFAULT_TIMEZONE, addDaysToKey, zonedTimeToUtc } from "../utils/datetime.js";
import { parsePagination } from "../utils/pagination.js";
import {
  auditQuerySchema,
  couponListQuerySchema,
  createCouponSchema,
  moderateReviewSchema,
  platformAnalyticsQuerySchema,
  reviewListQuerySchema,
  searchQuerySchema,
  settingsUpdateSchema,
  updateCouponSchema,
  userStatusSchema,
  venueReviewSchema,
} from "../validators/admin.schema.js";
import { getPaymentsSummary, listPayments, listPayoutBalances, listPayouts, recordPayout } from "../services/earnings.service.js";
import { retryRefund } from "../services/payment.service.js";
import { recordAudit } from "../services/audit.service.js";
import { moneyRangeSchema, paymentListQuerySchema, payoutSchema } from "../validators/payment.schema.js";

const router = Router();

// Every route here is admin-only.
router.use(authenticate, authorize("ADMIN"));

const id = (req: Request) => String(req.params.id);

/**
 * @swagger
 * /admin/dashboard:
 *   get:
 *     summary: Get admin dashboard statistics and work queues
 *     tags:
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Admin dashboard statistics
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get("/dashboard", asyncHandler(getAdminDashboardController));

/**
 * @swagger
 * /admin/bookings:
 *   get:
 *     summary: All bookings (?status=, ?venueId=, ?q= booking code, id or customer)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Page of bookings }
 */
router.get("/bookings", asyncHandler(getAdminBookingsController));

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: All users (?role=, ?status=, ?q= name or email)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Page of users }
 * /admin/users/{id}:
 *   get:
 *     summary: One user with bookings, venues, sessions and moderation history
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: User detail }
 *       404: { description: Not found }
 * /admin/users/{id}/status:
 *   patch:
 *     summary: "Suspend, ban or reactivate (status: ACTIVE | SUSPENDED | BANNED; reason required unless ACTIVE)"
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: New status }
 *       403: { description: Own account or another admin }
 */
router.get("/users", asyncHandler(getAdminUsersController));

router.get(
  "/users/:id",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await getAdminUserDetail(id(req)));
  })
);

router.patch(
  "/users/:id/status",
  validate(userStatusSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ user: await setUserStatus(id(req), req.body.status, req.body.reason || null, req.user!) });
  })
);

/**
 * @swagger
 * /admin/venues:
 *   get:
 *     summary: All venues (?approvalStatus=PENDING for the approval queue, oldest first; ?q=)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Page of venues }
 * /admin/venues/{id}/review:
 *   post:
 *     summary: "Approve or reject a venue (decision: APPROVED | REJECTED; reason required to reject); the owner is notified"
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Venue }
 */
router.get("/venues", asyncHandler(getAdminVenuesController));

router.post(
  "/venues/:id/review",
  validate(venueReviewSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ venue: await reviewVenue(id(req), req.body.decision, req.body.reason || null) });
  })
);

/**
 * @swagger
 * /admin/reviews:
 *   get:
 *     summary: Reviews with their reports (?status=FLAGGED for the moderation queue)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Page of reviews }
 * /admin/reviews/{id}/moderate:
 *   post:
 *     summary: "Hide or restore a review (status: HIDDEN | VISIBLE); closes open reports and updates the venue rating"
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Review }
 */
router.get(
  "/reviews",
  asyncHandler(async (req: Request, res: Response) => {
    const filters = reviewListQuerySchema.parse(req.query);
    const { items, pagination } = await listReviewsForModeration(parsePagination(req.query), filters);
    res.json({ reviews: items, pagination });
  })
);

router.post(
  "/reviews/:id/moderate",
  validate(moderateReviewSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ review: await moderateReview(id(req), req.body.status, req.body.note || null) });
  })
);

/**
 * @swagger
 * /admin/coupons:
 *   get:
 *     summary: Coupons with how often they've been used (?q=, ?active=)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Page of coupons }
 *   post:
 *     summary: Create a coupon (PERCENT or FLAT; optional limits, dates, minimum amount and venue)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Coupon }
 *       409: { description: Code already exists }
 * /admin/coupons/{id}:
 *   patch:
 *     summary: Change a coupon (e.g. isActive false to switch it off)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Coupon }
 *   delete:
 *     summary: Delete a coupon that was never used
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Deleted }
 *       409: { description: Already used; switch it off instead }
 */
router.get(
  "/coupons",
  asyncHandler(async (req: Request, res: Response) => {
    const { items, pagination } = await listCoupons(parsePagination(req.query), couponListQuerySchema.parse(req.query));
    res.json({ coupons: items, pagination });
  })
);

router.post(
  "/coupons",
  validate(createCouponSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json({ coupon: await createCoupon(req.body, req.user!.id) });
  })
);

router.patch(
  "/coupons/:id",
  validate(updateCouponSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ coupon: await updateCoupon(id(req), req.body) });
  })
);

router.delete(
  "/coupons/:id",
  asyncHandler(async (req: Request, res: Response) => {
    await deleteCoupon(id(req));
    res.status(204).end();
  })
);

/**
 * @swagger
 * /admin/audit-logs:
 *   get:
 *     summary: Audit log, newest first (?actorId, ?action - "venue." matches all venue actions, ?entityType, ?entityId, ?from, ?to)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Page of entries, plus the known action names }
 */
router.get(
  "/audit-logs",
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to, ...filters } = auditQuerySchema.parse(req.query);
    const [{ items, pagination }, actions] = await Promise.all([
      listAuditLogs(
        {
          ...filters,
          from: from ? zonedTimeToUtc(from, "00:00", DEFAULT_TIMEZONE) : undefined,
          to: to ? zonedTimeToUtc(addDaysToKey(to, 1), "00:00", DEFAULT_TIMEZONE) : undefined,
        },
        parsePagination(req.query)
      ),
      listAuditActions(),
    ]);
    res.json({ logs: items, actions, pagination });
  })
);

/**
 * @swagger
 * /admin/analytics:
 *   get:
 *     summary: Platform report - GMV, bookings by day, conversion, top venues and cities, cohort retention
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, required: true, schema: { type: string, example: "2026-09-01" } }
 *       - { in: query, name: to, required: true, schema: { type: string, example: "2026-09-30" } }
 *     responses:
 *       200: { description: Report }
 */
router.get(
  "/analytics",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await getPlatformAnalytics(platformAnalyticsQuerySchema.parse(req.query)));
  })
);

/**
 * @swagger
 * /admin/search:
 *   get:
 *     summary: Find users, venues and bookings (name, email, city, booking code or id)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ users, venues, bookings } - up to 6 of each" }
 */
/**
 * @swagger
 * /admin/payments:
 *   get:
 *     summary: Online payments, newest first (filter by status; search order/payment id, booking code or email)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ payments, pagination }" }
 */
router.get(
  "/payments",
  asyncHandler(async (req: Request, res: Response) => {
    const { items, pagination } = await listPayments(paymentListQuerySchema.parse(req.query), parsePagination(req.query));
    res.json({ payments: items, pagination });
  })
);

/**
 * @swagger
 * /admin/payments/summary:
 *   get:
 *     summary: Reconciliation - money in and out for a period, commission, and anything that doesn't add up
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, required: true, schema: { type: string } }
 *       - { in: query, name: to, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Summary with issues }
 */
router.get(
  "/payments/summary",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await getPaymentsSummary(moneyRangeSchema.parse(req.query)));
  })
);

/**
 * @swagger
 * /admin/refunds/{id}/retry:
 *   post:
 *     summary: Send a failed refund to the gateway again
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Queued }
 *       409: { description: The refund isn't failed }
 */
router.post(
  "/refunds/:id/retry",
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    await retryRefund(id);
    await recordAudit({ action: "refund.retried", entityType: "Refund", entityId: id });
    res.status(204).end();
  })
);

/**
 * @swagger
 * /admin/payouts:
 *   get:
 *     summary: What each provider is owed, and payouts recorded so far
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ balances, payouts, pagination }" }
 *   post:
 *     summary: Record that a provider's whole balance was transferred (e.g. bank transfer reference)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "{ payout }" }
 *       409: { description: Nothing is owed }
 */
router.get(
  "/payouts",
  asyncHandler(async (req: Request, res: Response) => {
    const [balances, payouts] = await Promise.all([listPayoutBalances(), listPayouts(parsePagination(req.query))]);
    res.json({ balances, payouts: payouts.items, pagination: payouts.pagination });
  })
);

router.post(
  "/payouts",
  validate(payoutSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json({ payout: await recordPayout(req.user!.id, req.body) });
  })
);

router.get(
  "/search",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await adminSearch(searchQuerySchema.parse(req.query).q));
  })
);

/**
 * @swagger
 * /admin/settings:
 *   get:
 *     summary: Platform settings with labels and defaults
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Settings }
 *   put:
 *     summary: "Change some settings, e.g. {\"commissionPercent\": 12}"
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Settings }
 *       400: { description: Unknown key or invalid value }
 */
router.get(
  "/settings",
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ settings: await describeSettings() });
  })
);

router.put(
  "/settings",
  validate(settingsUpdateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ settings: await updateSettings(req.body, req.user!.id) });
  })
);

export default router;
