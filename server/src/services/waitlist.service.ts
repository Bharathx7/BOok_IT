import prisma from "../config/prisma.js";
import { env } from "../config/env.js";
import { formatInTimeZone } from "../utils/datetime.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { notify } from "./notification.service.js";
import { findPublicVenue } from "./venueVisibility.js";
import { holdsTimeWhere } from "./bookingHolds.js";

// Waitlist: customers queue for a time that is taken. When it frees up
// (cancellation, expiry, reschedule, a closure removed), the earliest entry
// whose whole time is now bookable is told. If they haven't booked within
// NOTIFY_WINDOW, the entry lapses and the next person is told.

export const NOTIFY_WINDOW_MS = 30 * 60 * 1000;
const MAX_ACTIVE_PER_USER = 5;
const ACTIVE = ["WAITING", "NOTIFIED"] as const;

/** Could someone book exactly this range right now? */
export async function isRangeAvailable(venueId: string, startTime: Date, endTime: Date) {
  const now = new Date();
  const [slot, booking, closure] = await Promise.all([
    prisma.timeSlot.findFirst({ where: { venueId, startTime: { lte: startTime }, endTime: { gte: endTime } } }),
    prisma.booking.findFirst({
      where: { venueId, startTime: { lt: endTime }, endTime: { gt: startTime }, ...holdsTimeWhere(now) },
    }),
    prisma.blackoutDate.findFirst({ where: { venueId, startTime: { lt: endTime }, endTime: { gt: startTime } } }),
  ]);

  return Boolean(slot) && !booking && !closure;
}

export async function joinWaitlist(userId: string, venueId: string, startTime: Date, endTime: Date) {
  if (startTime <= new Date()) throw new ValidationError("That time has already started");
  if (endTime <= startTime) throw new ValidationError("The end must be after the start");

  await findPublicVenue(venueId);

  if (await isRangeAvailable(venueId, startTime, endTime)) {
    throw new ConflictError("This time is free - you can book it now");
  }

  const active = await prisma.waitlistEntry.findMany({
    where: { userId, status: { in: [...ACTIVE] } },
    select: { venueId: true, startTime: true, endTime: true },
  });

  if (active.some((e) => e.venueId === venueId && +e.startTime === +startTime && +e.endTime === +endTime)) {
    throw new ConflictError("You're already on the waitlist for this time");
  }

  if (active.length >= MAX_ACTIVE_PER_USER) {
    throw new ConflictError(`You can wait for at most ${MAX_ACTIVE_PER_USER} times at once`);
  }

  const entry = await prisma.waitlistEntry.create({ data: { userId, venueId, startTime, endTime } });
  const position = await prisma.waitlistEntry.count({
    where: {
      venueId,
      status: { in: [...ACTIVE] },
      startTime: { lt: endTime },
      endTime: { gt: startTime },
      createdAt: { lte: entry.createdAt },
    },
  });

  return { entry, position };
}

export async function leaveWaitlist(userId: string, entryId: string) {
  const { count } = await prisma.waitlistEntry.updateMany({
    where: { id: entryId, userId, status: { in: [...ACTIVE] } },
    data: { status: "CANCELLED" },
  });
  if (count === 0) throw new NotFoundError("Waitlist entry not found");
}

export const listMyWaitlist = (userId: string) =>
  prisma.waitlistEntry.findMany({
    where: { userId, status: { in: [...ACTIVE] }, startTime: { gt: new Date() } },
    orderBy: { startTime: "asc" },
    include: { venue: { select: { id: true, name: true, timezone: true } } },
  });

/** A customer booked: their matching waitlist entries are done. */
export async function markWaitlistBooked(userId: string, venueId: string, startTime: Date, endTime: Date) {
  await prisma.waitlistEntry.updateMany({
    where: { userId, venueId, status: { in: [...ACTIVE] }, startTime: { lt: endTime }, endTime: { gt: startTime } },
    data: { status: "BOOKED" },
  });
}

/** Time [from, to) at a venue may have freed up: tell whoever is first in line. */
export async function processWaitlist(venueId: string, from: Date, to: Date) {
  const now = new Date();
  const entries = await prisma.waitlistEntry.findMany({
    where: {
      venueId,
      status: "WAITING",
      startTime: { gt: now, lt: to },
      endTime: { gt: from },
    },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { id: true, name: true, email: true } },
      venue: { select: { name: true, timezone: true } },
    },
    take: 50,
  });

  const notified: { startTime: Date; endTime: Date }[] = [];

  for (const entry of entries) {
    // Don't send two people after the same freed time.
    if (notified.some((n) => n.startTime < entry.endTime && n.endTime > entry.startTime)) continue;

    // Someone earlier in line is already holding a notification for it.
    const pending = await prisma.waitlistEntry.findFirst({
      where: { venueId, status: "NOTIFIED", startTime: { lt: entry.endTime }, endTime: { gt: entry.startTime } },
    });
    if (pending) continue;

    if (!(await isRangeAvailable(venueId, entry.startTime, entry.endTime))) continue;

    const { count } = await prisma.waitlistEntry.updateMany({
      where: { id: entry.id, status: "WAITING" },
      data: { status: "NOTIFIED", notifiedAt: now },
    });
    if (count === 0) continue;

    notified.push(entry);
    const when = formatInTimeZone(entry.startTime, entry.venue.timezone);
    const link = `${env.APP_URL}/customer/venues/${venueId}`;

    await notify({
      userId: entry.user.id,
      type: "WAITLIST_AVAILABLE",
      title: "A spot opened up",
      body: `${entry.venue.name} is free for ${when}. Book within 30 minutes before the next person in line is told.`,
      data: { venueId, waitlistEntryId: entry.id, startTime: entry.startTime.toISOString() },
      email: {
        to: entry.user.email,
        subject: `BookIt - ${entry.venue.name} is free for ${when}`,
        content: {
          preview: "The time you were waiting for is free.",
          heading: "A spot opened up",
          greeting: `Hello ${entry.user.name},`,
          paragraphs: [
            `The time you were waiting for at ${entry.venue.name} is now free.`,
            "It isn't held for you - book it within 30 minutes, after that the next person in line is told.",
          ],
          details: [
            ["Venue", entry.venue.name],
            ["Starts", when],
            ["Ends", formatInTimeZone(entry.endTime, entry.venue.timezone)],
          ],
          button: { label: "Book now", url: link },
        },
      },
    });
  }

  return notified.length;
}

/** Maintenance: lapse unused notifications (then tell the next person) and past entries. */
export async function expireWaitlist(now = new Date()) {
  await prisma.waitlistEntry.updateMany({
    where: { status: { in: [...ACTIVE] }, startTime: { lte: now } },
    data: { status: "EXPIRED" },
  });

  const lapsed = await prisma.waitlistEntry.findMany({
    where: { status: "NOTIFIED", notifiedAt: { lte: new Date(now.getTime() - NOTIFY_WINDOW_MS) } },
    select: { id: true, venueId: true, startTime: true, endTime: true },
  });

  for (const entry of lapsed) {
    await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { status: "EXPIRED" } });
    try {
      await processWaitlist(entry.venueId, entry.startTime, entry.endTime);
    } catch (error) {
      logger.error({ err: error, entryId: entry.id }, "Waitlist hand-over failed");
    }
  }

  return lapsed.length;
}
