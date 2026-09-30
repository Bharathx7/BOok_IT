import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authenticate, optionalAuthenticate, requireVerifiedEmail } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  cancelSeries,
  checkIn,
  createSeries,
  getBookingDetail,
  getInvite,
  inviteParticipants,
  markNoShow,
  MAX_SERIES_WEEKS,
  previewSeries,
  removeParticipant,
  rescheduleBooking,
  respondToInvite,
  todaysArrivals,
} from "../services/bookingFeatures.service.js";
import { joinWaitlist, leaveWaitlist, listMyWaitlist } from "../services/waitlist.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Mounted at /api. Rescheduling, weekly series, invites, check-in, waitlist.
const router = Router();

const param = (req: Request, name: string) => String(req.params[name]);

const timeRange = z
  .object({ startTime: z.string().datetime(), endTime: z.string().datetime() })
  .refine((data) => data.startTime < data.endTime, { message: "The end must be after the start", path: ["endTime"] });

const seriesSchema = z.object({
  venueId: z.string().uuid(),
  startTime: z.string().datetime(),
  durationMinutes: z.number().int().min(15).max(12 * 60),
  weeks: z.number().int().min(2).max(MAX_SERIES_WEEKS),
});

const invitesSchema = z.object({
  invites: z
    .array(
      z.object({
        email: z.string().trim().toLowerCase().email("Invalid email address"),
        name: z.string().trim().max(100).nullable().optional(),
      })
    )
    .min(1)
    .max(20),
});

const toSeries = (body: z.infer<typeof seriesSchema>) => ({ ...body, startTime: new Date(body.startTime) });

/**
 * @swagger
 * /bookings/{id}/details:
 *   get:
 *     summary: Booking with participants, series, reschedule links and a timeline (customer, accepted guests, venue owner)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Booking detail }
 * /bookings/{id}/reschedule:
 *   put:
 *     summary: Move a booking to a new time (until 2 hours before it starts)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The new booking; the old one is marked as moved }
 *       409: { description: New time taken, or too late to move }
 */
router.get(
  "/bookings/:id/details",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ booking: await getBookingDetail(param(req, "id"), req.user!) });
  })
);

router.put(
  "/bookings/:id/reschedule",
  authenticate,
  validate(timeRange),
  asyncHandler(async (req: Request, res: Response) => {
    const booking = await rescheduleBooking(
      param(req, "id"),
      req.user!,
      new Date(req.body.startTime),
      new Date(req.body.endTime)
    );
    res.json({ booking });
  })
);

/**
 * @swagger
 * /bookings/recurring/preview:
 *   post:
 *     summary: Which weeks of a weekly series are free (books nothing)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: One entry per week with available / reason }
 * /bookings/recurring:
 *   post:
 *     summary: Book every free week (2-12 weeks, same local time); taken weeks are reported
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "{ groupId, booked, skipped, results }" }
 *       409: { description: No week available }
 * /bookings/recurring/{groupId}/cancel:
 *   post:
 *     summary: Cancel all upcoming weeks of a series
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ cancelled }" }
 */
router.post(
  "/bookings/recurring/preview",
  authenticate,
  validate(seriesSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ weeks: await previewSeries(toSeries(req.body)) });
  })
);

router.post(
  "/bookings/recurring",
  authenticate,
  requireVerifiedEmail,
  authorize("USER"),
  validate(seriesSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await createSeries(req.user!.id, toSeries(req.body)));
  })
);

router.post(
  "/bookings/recurring/:groupId/cancel",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await cancelSeries(param(req, "groupId"), req.user!));
  })
);

/**
 * @swagger
 * /bookings/{id}/participants:
 *   post:
 *     summary: Invite friends by email (customer only, max 20)
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Participant list }
 * /bookings/{id}/participants/{participantId}:
 *   delete:
 *     summary: Remove an invited person
 *     tags: [Bookings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Removed }
 * /invites/{token}:
 *   get:
 *     summary: What an invite link is for
 *     tags: [Bookings]
 *     responses:
 *       200: { description: Invite }
 * /invites/{token}/respond:
 *   post:
 *     summary: Accept or decline an invite (links it to the account when signed in)
 *     tags: [Bookings]
 *     responses:
 *       200: { description: New status }
 */
router.post(
  "/bookings/:id/participants",
  authenticate,
  validate(invitesSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json({ participants: await inviteParticipants(param(req, "id"), req.user!, req.body.invites) });
  })
);

router.delete(
  "/bookings/:id/participants/:participantId",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    await removeParticipant(param(req, "id"), param(req, "participantId"), req.user!);
    res.status(204).end();
  })
);

router.get(
  "/invites/:token",
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ invite: await getInvite(param(req, "token")) });
  })
);

router.post(
  "/invites/:token/respond",
  optionalAuthenticate,
  validate(z.object({ accept: z.boolean() })),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await respondToInvite(param(req, "token"), req.body.accept, req.user));
  })
);

/**
 * @swagger
 * /check-in:
 *   post:
 *     summary: Check in a booking by its code (venue owner; from 1 hour before the start until the end)
 *     tags: [Check-in]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Checked-in booking }
 *       404: { description: No such booking at your venues }
 *       409: { description: Too early, ended, not confirmed or already checked in }
 * /bookings/{id}/no-show:
 *   patch:
 *     summary: Mark (or unmark) a started booking as a no-show
 *     tags: [Check-in]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated booking }
 * /provider/arrivals:
 *   get:
 *     summary: Today's confirmed bookings at a venue with check-in status
 *     tags: [Check-in]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Bookings }
 */
router.post(
  "/check-in",
  authenticate,
  authorize("ADMIN", "PROVIDER"),
  validate(z.object({ code: z.string().trim().min(4).max(20) })),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ booking: await checkIn(req.body.code, req.user!) });
  })
);

router.patch(
  "/bookings/:id/no-show",
  authenticate,
  authorize("ADMIN", "PROVIDER"),
  validate(z.object({ noShow: z.boolean() })),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ booking: await markNoShow(param(req, "id"), req.user!, req.body.noShow) });
  })
);

router.get(
  "/provider/arrivals",
  authenticate,
  authorize("ADMIN", "PROVIDER"),
  asyncHandler(async (req: Request, res: Response) => {
    const venueId = z.string().uuid().parse(req.query.venueId);
    res.json({ bookings: await todaysArrivals(venueId, req.user!) });
  })
);

/**
 * @swagger
 * /waitlist:
 *   get:
 *     summary: My active waitlist entries
 *     tags: [Waitlist]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Entries }
 *   post:
 *     summary: Join the waitlist for a taken time (max 5 at once)
 *     tags: [Waitlist]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "{ entry, position }" }
 *       409: { description: The time is free, or already waiting }
 * /waitlist/{id}:
 *   delete:
 *     summary: Leave the waitlist
 *     tags: [Waitlist]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Left }
 */
router.get(
  "/waitlist",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ entries: await listMyWaitlist(req.user!.id) });
  })
);

router.post(
  "/waitlist",
  authenticate,
  authorize("USER"),
  validate(z.object({ venueId: z.string().uuid() }).and(timeRange)),
  asyncHandler(async (req: Request, res: Response) => {
    res
      .status(201)
      .json(await joinWaitlist(req.user!.id, req.body.venueId, new Date(req.body.startTime), new Date(req.body.endTime)));
  })
);

router.delete(
  "/waitlist/:id",
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    await leaveWaitlist(req.user!.id, param(req, "id"));
    res.status(204).end();
  })
);

export default router;
