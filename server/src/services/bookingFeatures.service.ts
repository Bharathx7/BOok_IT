import prisma from "../config/prisma.js";
import { env } from "../config/env.js";
import type { Prisma } from "../generated/prisma/client.js";
import { emitBookingEvent } from "../sockets/socket.js";
import { runInBackground } from "../utils/background.js";
import { newBookingCode, normalizeBookingCode } from "../utils/bookingCode.js";
import {
  addDaysToKey,
  formatInTimeZone,
  localParts,
  zonedTimeToUtc,
} from "../utils/datetime.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors.js";
import { generateOpaqueToken, hashToken } from "../utils/tokens.js";
import { bookingPartiesInclude } from "./bookingLifecycle.service.js";
import {
  assertBookableTime,
  cancelBooking,
  createBooking,
  holdUntil,
  insertBookingLocked,
  priceFor,
} from "./booking.service.js";
import { queueEmail } from "./email.service.js";
import { notify } from "./notification.service.js";
import { processWaitlist } from "./waitlist.service.js";
import { findPublicVenue, isPublicVenue } from "./venueVisibility.js";
import { computeDiscount } from "./coupon.service.js";
import { holdsTimeWhere } from "./bookingHolds.js";
import { paidPaise, paymentSummarySelect, paysOnline, toPaise } from "./payment.service.js";

const HOUR = 3_600_000;
/** Customers can move a booking until this long before it starts. */
export const RESCHEDULE_CUTOFF_MS = 2 * HOUR;
/** Check-in opens this long before the start and closes at the end. */
export const CHECK_IN_EARLY_MS = HOUR;
export const MAX_SERIES_WEEKS = 12;
const MAX_PARTICIPANTS = 20;

type Actor = { id: string; role: string };

const isVenueManager = (actor: Actor, ownerId: string) => actor.role === "ADMIN" || actor.id === ownerId;

// ---------------------------------------------------------------------------
// Booking detail (customer, accepted participants, venue owner)
// ---------------------------------------------------------------------------

export async function getBookingDetail(bookingId: string, actor: Actor) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      venue: { select: { id: true, name: true, address: true, city: true, timezone: true, ownerId: true, cancellationPolicy: true, latitude: true, longitude: true, paymentMode: true } },
      payments: { select: paymentSummarySelect, orderBy: { createdAt: "asc" } },
      user: { select: { id: true, name: true, email: true } },
      review: { select: { id: true, rating: true, review: true, providerReply: true } },
      participants: {
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, name: true, status: true, respondedAt: true, userId: true },
      },
      rescheduledFrom: { select: { id: true, startTime: true, endTime: true } },
      rescheduledTo: { select: { id: true, startTime: true, endTime: true } },
      recurringGroup: { select: { id: true, weeks: true, weekday: true, startTime: true } },
      coupon: { select: { code: true } },
    },
  });

  if (!booking) throw new NotFoundError("Booking not found");

  const isCustomer = booking.userId === actor.id;
  const isManager = isVenueManager(actor, booking.venue.ownerId);
  const isParticipant = booking.participants.some((p) => p.userId === actor.id && p.status === "ACCEPTED");

  if (!isCustomer && !isManager && !isParticipant) throw new NotFoundError("Booking not found");

  // Timeline of what is known about this booking, oldest first.
  const timeline = [
    { at: booking.createdAt, label: booking.rescheduledFrom ? "Moved here from an earlier time" : "Requested" },
    ...booking.payments.flatMap((payment) => [
      ...(payment.capturedAt ? [{ at: payment.capturedAt, label: "Paid" }] : []),
      ...payment.refunds.flatMap((refund) => (refund.processedAt ? [{ at: refund.processedAt, label: "Refunded" }] : [])),
    ]),
    ...(booking.checkedInAt ? [{ at: booking.checkedInAt, label: "Checked in" }] : []),
    ...(booking.noShow ? [{ at: booking.endTime, label: "Marked as no-show" }] : []),
    ...(booking.status === "COMPLETED" ? [{ at: booking.endTime, label: "Completed" }] : []),
    ...(booking.cancelledAt
      ? [{ at: booking.cancelledAt, label: booking.rescheduledTo ? "Moved to another time" : "Cancelled" }]
      : []),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const series = booking.recurringGroupId
    ? await prisma.booking.findMany({
        where: { recurringGroupId: booking.recurringGroupId },
        orderBy: { startTime: "asc" },
        select: { id: true, startTime: true, status: true },
      })
    : [];

  return {
    ...booking,
    // Participants see who else is coming, not the organiser's contact details.
    user: isCustomer || isManager ? booking.user : { id: booking.user.id, name: booking.user.name, email: null },
    canManage: isCustomer,
    canReschedule:
      isCustomer &&
      booking.source === "ONLINE" &&
      ["PENDING", "CONFIRMED"].includes(booking.status) &&
      booking.startTime.getTime() - Date.now() > RESCHEDULE_CUTOFF_MS,
    timeline,
    series,
  };
}

// ---------------------------------------------------------------------------
// Reschedule
// ---------------------------------------------------------------------------

/**
 * Moves a booking to a new time in one transaction: the old booking is
 * closed (marked as moved) and a new one created with the same status, so
 * the customer can never end up with both or neither. The new time follows
 * the normal booking rules and is priced afresh.
 */
export async function rescheduleBooking(bookingId: string, actor: Actor, startTime: Date, endTime: Date) {
  const old = await prisma.booking.findUnique({ where: { id: bookingId }, include: { coupon: true } });
  const paid = old ? await paidPaise(prisma, old.id) : 0;

  if (!old || old.userId !== actor.id) throw new NotFoundError("Booking not found");
  if (old.source !== "ONLINE") throw new ValidationError("Only online bookings can be moved");
  if (!["PENDING", "CONFIRMED"].includes(old.status)) {
    throw new ConflictError("Only upcoming bookings can be moved");
  }
  if (old.startTime.getTime() - Date.now() <= RESCHEDULE_CUTOFF_MS) {
    throw new ConflictError("Bookings can only be moved until 2 hours before they start");
  }
  if (startTime <= new Date()) throw new ValidationError("Choose a time in the future");
  if (+startTime === +old.startTime && +endTime === +old.endTime) {
    throw new ValidationError("That's the time you already have");
  }

  const { booking } = await insertBookingLocked(
    old.venueId,
    startTime,
    endTime,
    async (tx, venue) => {
      if (!isPublicVenue(venue)) throw new NotFoundError("Venue not found");
      await assertBookableTime(tx, venue, startTime, endTime);
      const price = priceFor(venue, startTime, endTime);
      // A code used on the original booking comes along; its discount is
      // worked out again for the new price (the use was already counted).
      const discount = old.coupon ? computeDiscount(old.coupon, price.total) : null;

      const newTotal = discount === null ? price.total : Math.round((price.total - discount) * 100) / 100;
      if (paid > 0 && toPaise(newTotal) !== toPaise(old.totalPrice)) {
        throw new ConflictError(
          "This booking is paid, and the new time costs a different amount. Cancel it (the venue's refund policy applies) and book the new time instead."
        );
      }

      const created = await tx.booking.create({
        data: {
          userId: old.userId,
          venueId: old.venueId,
          startTime,
          endTime,
          status: old.status,
          expiresAt: old.status === "PENDING" ? holdUntil(venue, startTime) : null,
          bookingCode: newBookingCode(),
          rescheduledFromId: old.id,
          recurringGroupId: old.recurringGroupId,
          totalPrice: discount === null ? price.total : Math.round((price.total - discount) * 100) / 100,
          priceBreakdown: price.breakdown as unknown as Prisma.InputJsonValue,
          couponId: old.couponId,
          discountAmount: discount,
        },
        include: bookingPartiesInclude,
      });

      // Invited friends come along, and so does the payment.
      await tx.bookingParticipant.updateMany({ where: { bookingId: old.id }, data: { bookingId: created.id } });
      if (paid > 0) {
        await tx.payment.updateMany({ where: { bookingId: old.id }, data: { bookingId: created.id } });
        await tx.ledgerEntry.updateMany({ where: { bookingId: old.id }, data: { bookingId: created.id } });
      }
      return created;
    },
    async (tx) => {
      // Release the old time first so the new one may overlap it.
      const { count } = await tx.booking.updateMany({
        where: { id: old.id, status: { in: ["PENDING", "CONFIRMED"] } },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.id },
      });
      if (count === 0) throw new ConflictError("This booking changed in the meantime; refresh and try again");
    }
  );

  emitBookingEvent("bookingCreated", booking, booking.venue.ownerId);

  runInBackground("reschedule follow-up", async () => {
    const tz = booking.venue.timezone;
    await notify({
      userId: booking.venue.owner.id,
      type: "BOOKING_RESCHEDULED",
      title: "Booking moved",
      body: `${booking.user.name} moved their booking at ${booking.venue.name} from ${formatInTimeZone(old.startTime, tz)} to ${formatInTimeZone(startTime, tz)}.`,
      data: { bookingId: booking.id, venueId: booking.venueId },
    });
    await processWaitlist(old.venueId, old.startTime, old.endTime);
  });

  return booking;
}

// ---------------------------------------------------------------------------
// Weekly series
// ---------------------------------------------------------------------------

interface SeriesInput {
  venueId: string;
  /** First occurrence; later ones are the same local time each week. */
  startTime: Date;
  durationMinutes: number;
  weeks: number;
}

/** Same local wall-clock time on each week (safe across DST changes). */
function occurrences(first: Date, durationMinutes: number, weeks: number, timeZone: string) {
  const local = localParts(first, timeZone);
  const time = `${String(Math.floor(local.minutes / 60)).padStart(2, "0")}:${String(local.minutes % 60).padStart(2, "0")}`;

  return Array.from({ length: weeks }, (_, week) => {
    const start = zonedTimeToUtc(addDaysToKey(local.dateKey, week * 7), time, timeZone);
    return { start, end: new Date(start.getTime() + durationMinutes * 60_000) };
  });
}

const seriesVenue = (venueId: string) => findPublicVenue(venueId);

const assertSeriesAllowed = (venue: { paymentMode: string }) => {
  if (paysOnline(venue)) {
    throw new ValidationError("Weekly series aren't available at venues that take payment online yet; book each week separately");
  }
};

function checkSeriesInput(input: SeriesInput) {
  if (input.weeks < 2 || input.weeks > MAX_SERIES_WEEKS) {
    throw new ValidationError(`A series is 2 to ${MAX_SERIES_WEEKS} weeks`);
  }
  if (input.startTime <= new Date()) throw new ValidationError("Choose a time in the future");
}

/** Which weeks are free - nothing is booked. */
export async function previewSeries(input: SeriesInput) {
  checkSeriesInput(input);
  const venue = await seriesVenue(input.venueId);
  assertSeriesAllowed(venue);
  const now = new Date();

  const results = [];
  for (const { start, end } of occurrences(input.startTime, input.durationMinutes, input.weeks, venue.timezone)) {
    let problem: string | null = null;
    try {
      await assertBookableTime(prisma, venue, start, end);
      const clash = await prisma.booking.findFirst({
        where: {
          venueId: venue.id,
          startTime: { lt: end },
          endTime: { gt: start },
          ...holdsTimeWhere(now),
        },
      });
      if (clash) problem = "Already booked";
    } catch (error) {
      problem = error instanceof Error ? error.message : "Not available";
    }
    results.push({ startTime: start, endTime: end, available: problem === null, reason: problem });
  }

  return results;
}

/**
 * Books every free week of a series. Weeks that are taken are reported, not
 * fatal - unless none at all could be booked.
 */
export async function createSeries(userId: string, input: SeriesInput) {
  checkSeriesInput(input);
  const venue = await seriesVenue(input.venueId);
  assertSeriesAllowed(venue);
  const planned = occurrences(input.startTime, input.durationMinutes, input.weeks, venue.timezone);
  const first = localParts(planned[0]!.start, venue.timezone);

  const group = await prisma.recurringBooking.create({
    data: {
      userId,
      venueId: venue.id,
      weekday: first.weekday,
      startTime: `${String(Math.floor(first.minutes / 60)).padStart(2, "0")}:${String(first.minutes % 60).padStart(2, "0")}`,
      durationMinutes: input.durationMinutes,
      weeks: input.weeks,
      firstDate: new Date(`${first.dateKey}T00:00:00Z`),
    },
  });

  const results: { startTime: Date; endTime: Date; bookingId: string | null; reason: string | null }[] = [];

  for (const { start, end } of planned) {
    try {
      const booking = await createBooking(
        { userId, venueId: venue.id, startTime: start, endTime: end },
        { recurringGroupId: group.id, notify: false }
      );
      results.push({ startTime: start, endTime: end, bookingId: booking.id, reason: null });
    } catch (error) {
      results.push({
        startTime: start,
        endTime: end,
        bookingId: null,
        reason: error instanceof Error ? error.message : "Not available",
      });
    }
  }

  const booked = results.filter((r) => r.bookingId);

  if (booked.length === 0) {
    await prisma.recurringBooking.delete({ where: { id: group.id } });
    throw new ConflictError("None of those weeks are available");
  }

  // One notification for the owner instead of one per week.
  runInBackground("series notification", async () => {
    const owner = await prisma.user.findUnique({ where: { id: venue.ownerId }, select: { id: true } });
    const customer = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    if (!owner) return;
    await notify({
      userId: owner.id,
      type: "BOOKING_REQUESTED",
      title: "New weekly booking request",
      body: `${customer?.name ?? "A customer"} requested ${booked.length} weekly sessions at ${venue.name} from ${formatInTimeZone(planned[0]!.start, venue.timezone)}. Confirm each one on your Bookings page.`,
      data: { venueId: venue.id, recurringGroupId: group.id },
    });
  });

  return { groupId: group.id, booked: booked.length, skipped: results.length - booked.length, results };
}

/** Cancels every upcoming week of the customer's series. */
export async function cancelSeries(groupId: string, actor: Actor) {
  const group = await prisma.recurringBooking.findUnique({ where: { id: groupId } });
  if (!group || group.userId !== actor.id) throw new NotFoundError("Series not found");

  const upcoming = await prisma.booking.findMany({
    where: { recurringGroupId: groupId, status: { in: ["PENDING", "CONFIRMED"] }, startTime: { gt: new Date() } },
    select: { id: true },
  });

  // Reuse the normal cancel path so refunds, notifications and the waitlist apply.
  for (const { id } of upcoming) {
    await cancelBooking(id, actor.id, actor.role);
  }

  return { cancelled: upcoming.length };
}

// ---------------------------------------------------------------------------
// Invited friends
// ---------------------------------------------------------------------------

export async function inviteParticipants(
  bookingId: string,
  actor: Actor,
  invites: { email: string; name?: string | null | undefined }[]
) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      venue: { select: { name: true, timezone: true, address: true } },
      user: { select: { name: true, email: true } },
      participants: { select: { email: true } },
    },
  });

  if (!booking || booking.userId !== actor.id) throw new NotFoundError("Booking not found");
  if (!["PENDING", "CONFIRMED"].includes(booking.status) || booking.endTime <= new Date()) {
    throw new ConflictError("You can only invite people to upcoming bookings");
  }

  const existing = new Set(booking.participants.map((p) => p.email));
  const fresh = invites
    .map((invite) => ({ ...invite, email: invite.email.trim().toLowerCase() }))
    .filter((invite) => invite.email !== booking.user.email.toLowerCase() && !existing.has(invite.email));
  const unique = [...new Map(fresh.map((invite) => [invite.email, invite])).values()];

  if (booking.participants.length + unique.length > MAX_PARTICIPANTS) {
    throw new ValidationError(`A booking can have at most ${MAX_PARTICIPANTS} invited people`);
  }

  const when = formatInTimeZone(booking.startTime, booking.venue.timezone);

  for (const invite of unique) {
    const token = generateOpaqueToken();
    const account = await prisma.user.findFirst({
      where: { email: { equals: invite.email, mode: "insensitive" } },
      select: { id: true },
    });

    await prisma.bookingParticipant.create({
      data: {
        bookingId,
        email: invite.email,
        name: invite.name ?? null,
        userId: account?.id ?? null,
        inviteToken: hashToken(token),
      },
    });

    runInBackground("invite email", () =>
      queueEmail(invite.email, `BookIt - ${booking.user.name} invited you to play`, {
        preview: `${booking.venue.name}, ${when}`,
        heading: `${booking.user.name} invited you`,
        greeting: invite.name ? `Hello ${invite.name},` : "Hello,",
        paragraphs: [`${booking.user.name} booked ${booking.venue.name} and would like you to join.`],
        details: [
          ["Venue", booking.venue.name],
          ["When", when],
          ...(booking.venue.address ? [["Where", booking.venue.address] as [string, string]] : []),
        ],
        button: { label: "Accept or decline", url: `${env.APP_URL}/invites/${token}` },
      })
    );
  }

  return prisma.bookingParticipant.findMany({
    where: { bookingId },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, status: true, respondedAt: true },
  });
}

export async function removeParticipant(bookingId: string, participantId: string, actor: Actor) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { userId: true } });
  if (!booking || booking.userId !== actor.id) throw new NotFoundError("Booking not found");

  const { count } = await prisma.bookingParticipant.deleteMany({ where: { id: participantId, bookingId } });
  if (count === 0) throw new NotFoundError("Participant not found");
}

async function findInvite(token: string) {
  const participant = await prisma.bookingParticipant.findUnique({
    where: { inviteToken: hashToken(token) },
    include: {
      booking: {
        select: {
          id: true,
          startTime: true,
          endTime: true,
          status: true,
          user: { select: { name: true } },
          venue: { select: { id: true, name: true, address: true, city: true, timezone: true } },
        },
      },
    },
  });

  if (!participant) throw new NotFoundError("This invite link is invalid");
  return participant;
}

/** Public: what the invite is for (no contact details). */
export async function getInvite(token: string) {
  const participant = await findInvite(token);
  const { booking } = participant;

  return {
    status: participant.status,
    email: participant.email,
    organiser: booking.user.name,
    bookingStatus: booking.status,
    startTime: booking.startTime,
    endTime: booking.endTime,
    venue: booking.venue,
  };
}

export async function respondToInvite(token: string, accept: boolean, actor?: Actor) {
  const participant = await findInvite(token);

  if (!["PENDING", "CONFIRMED"].includes(participant.booking.status) || participant.booking.endTime <= new Date()) {
    throw new ConflictError("This booking is no longer active");
  }

  await prisma.bookingParticipant.update({
    where: { id: participant.id },
    data: {
      status: accept ? "ACCEPTED" : "DECLINED",
      respondedAt: new Date(),
      // Signed-in guests get the booking in their account.
      ...(actor && { userId: actor.id }),
    },
  });

  return { status: accept ? "ACCEPTED" : "DECLINED", bookingId: participant.booking.id };
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

const checkInSelect = {
  id: true,
  bookingCode: true,
  status: true,
  source: true,
  startTime: true,
  endTime: true,
  checkedInAt: true,
  noShow: true,
  guestName: true,
  user: { select: { name: true } },
  venue: { select: { id: true, name: true, timezone: true, ownerId: true } },
  _count: { select: { participants: { where: { status: "ACCEPTED" } } } },
} satisfies Prisma.BookingSelect;

/** Scanned or typed booking code -> checked in. */
export async function checkIn(code: string, actor: Actor) {
  const booking = await prisma.booking.findUnique({
    where: { bookingCode: normalizeBookingCode(code) },
    select: checkInSelect,
  });

  if (!booking || !isVenueManager(actor, booking.venue.ownerId)) {
    throw new NotFoundError("No booking with this code at your venues");
  }

  if (booking.checkedInAt) {
    throw new ConflictError(
      `Already checked in at ${formatInTimeZone(booking.checkedInAt, booking.venue.timezone)}`
    );
  }

  if (booking.status !== "CONFIRMED") {
    throw new ConflictError(
      booking.status === "PENDING" ? "This booking isn't confirmed yet" : `This booking is ${booking.status.toLowerCase()}`
    );
  }

  const now = Date.now();
  if (now < booking.startTime.getTime() - CHECK_IN_EARLY_MS) {
    throw new ConflictError(`Too early - check-in opens 1 hour before ${formatInTimeZone(booking.startTime, booking.venue.timezone)}`);
  }
  if (now > booking.endTime.getTime()) throw new ConflictError("This booking has already ended");

  return prisma.booking.update({
    where: { id: booking.id },
    data: { checkedInAt: new Date(), noShow: false },
    select: checkInSelect,
  });
}

export async function markNoShow(bookingId: string, actor: Actor, noShow: boolean) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: checkInSelect });

  if (!booking || !isVenueManager(actor, booking.venue.ownerId)) throw new NotFoundError("Booking not found");
  if (!["CONFIRMED", "COMPLETED"].includes(booking.status)) throw new ConflictError("Only confirmed bookings can be no-shows");
  if (booking.startTime > new Date()) throw new ConflictError("The booking hasn't started yet");
  if (booking.checkedInAt) throw new ConflictError("This customer checked in");

  return prisma.booking.update({ where: { id: bookingId }, data: { noShow }, select: checkInSelect });
}

/** Today's confirmed bookings at the venue, for the check-in screen. */
export async function todaysArrivals(venueId: string, actor: Actor) {
  const venue = await prisma.venue.findUnique({ where: { id: venueId }, select: { ownerId: true, timezone: true } });
  if (!venue || !isVenueManager(actor, venue.ownerId)) throw new ForbiddenError("You do not manage this venue");

  const today = localParts(new Date(), venue.timezone).dateKey;
  const start = zonedTimeToUtc(today, "00:00", venue.timezone);
  const end = zonedTimeToUtc(addDaysToKey(today, 1), "00:00", venue.timezone);

  return prisma.booking.findMany({
    where: {
      venueId,
      source: { not: "BLOCK" },
      status: { in: ["CONFIRMED", "COMPLETED"] },
      startTime: { gte: start, lt: end },
    },
    orderBy: { startTime: "asc" },
    select: checkInSelect,
  });
}
