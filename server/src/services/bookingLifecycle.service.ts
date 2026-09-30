import prisma from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { QUEUES, registerHandler } from "../jobs/queue.js";
import { emitBookingEvent, type BookingEvent } from "../sockets/socket.js";
import { logger } from "../utils/logger.js";
import { expireWaitlist, processWaitlist } from "./waitlist.service.js";
import {
  notifyBookingCompleted,
  notifyBookingExpired,
  notifyBookingReminder,
  notifyPaymentLapsed,
  type BookingWithParties,
} from "./bookingNotifications.service.js";
import { EXPIRING_STATUSES } from "./bookingHolds.js";

// Time-based booking changes, run every minute by the job queue. Each step
// looks at the database rather than at timers set earlier, so nothing is
// missed after downtime (e.g. a sleeping free-tier server) - the next run
// catches up. Every change is a conditional update, so a booking the owner
// confirms at the same moment is never expired by mistake.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const BATCH_SIZE = 200;

export const bookingPartiesInclude = {
  user: { select: { id: true, name: true, email: true } },
  venue: {
    select: {
      id: true,
      name: true,
      timezone: true,
      ownerId: true,
      owner: { select: { id: true, name: true, email: true } },
    },
  },
} satisfies Prisma.BookingInclude;

const emitSafely = (event: BookingEvent, booking: BookingWithParties & { status: string }) => {
  try {
    emitBookingEvent(event, booking, booking.venue.ownerId);
  } catch {
    // Socket.io isn't running (scripts, tests).
  }
};

/** Sends the socket event and notifications for bookings that just expired. */
export async function announceExpiredBookings(bookingIds: string[]) {
  if (bookingIds.length === 0) return;

  const bookings = await prisma.booking.findMany({
    where: { id: { in: bookingIds } },
    include: { ...bookingPartiesInclude, _count: { select: { payments: true } } },
  });

  for (const booking of bookings) {
    emitSafely("bookingExpired", booking);
    // A payment was started: the customer didn't finish paying, the owner never saw it.
    if (booking._count.payments > 0) await notifyPaymentLapsed(booking);
    else await notifyBookingExpired(booking);
    await processWaitlist(booking.venueId, booking.startTime, booking.endTime);
  }
}

/**
 * PENDING bookings the owner didn't confirm in time, and AWAITING_PAYMENT
 * bookings not paid in time, become EXPIRED, freeing the time. (A payment
 * that still arrives later is handled by the payment service.)
 */
export async function expireOverdueBookings(now = new Date()) {
  const due = await prisma.booking.findMany({
    where: { status: { in: [...EXPIRING_STATUSES] }, expiresAt: { lte: now } },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: BATCH_SIZE,
  });

  const expiredIds: string[] = [];

  for (const { id } of due) {
    const { count } = await prisma.booking.updateMany({
      where: { id, status: { in: [...EXPIRING_STATUSES] }, expiresAt: { lte: now } },
      data: { status: "EXPIRED" },
    });

    if (count > 0) expiredIds.push(id);
  }

  await announceExpiredBookings(expiredIds);
  return expiredIds.length;
}

/** CONFIRMED bookings whose end time has passed become COMPLETED. */
export async function completeFinishedBookings(now = new Date()) {
  const finished = await prisma.booking.findMany({
    where: { status: "CONFIRMED", endTime: { lte: now } },
    include: bookingPartiesInclude,
    orderBy: { endTime: "asc" },
    take: BATCH_SIZE,
  });

  let completed = 0;

  for (const booking of finished) {
    const { count } = await prisma.booking.updateMany({
      where: { id: booking.id, status: "CONFIRMED" },
      data: { status: "COMPLETED" },
    });

    if (count > 0) {
      completed++;
      emitSafely("bookingCompleted", { ...booking, status: "COMPLETED" });
      // Walk-ins and blocked time have no customer to ask for a review.
      if (booking.source === "ONLINE") await notifyBookingCompleted(booking);
    }
  }

  return completed;
}

/** "in about 3 hours", "in about 45 minutes". */
export function describeStartsIn(startTime: Date, now: Date) {
  const minutes = Math.max(1, Math.round((startTime.getTime() - now.getTime()) / MINUTE));

  if (minutes < 60) {
    return `in about ${Math.max(5, Math.round(minutes / 5) * 5)} minutes`;
  }

  const hours = Math.round(minutes / 60);
  return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
}

/**
 * Reminders go out once ~24 h and once ~2 h before a confirmed booking. A
 * booking confirmed less than 2 h ahead only gets the 2 h reminder.
 */
export async function sendDueReminders(now = new Date()) {
  const in2Hours = new Date(now.getTime() + 2 * HOUR);
  const in24Hours = new Date(now.getTime() + 24 * HOUR);
  let sent = 0;

  const dueSoon = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      source: "ONLINE",
      reminder2hSentAt: null,
      startTime: { gt: now, lte: in2Hours },
    },
    include: bookingPartiesInclude,
    take: BATCH_SIZE,
  });

  for (const booking of dueSoon) {
    const { count } = await prisma.booking.updateMany({
      where: { id: booking.id, status: "CONFIRMED", reminder2hSentAt: null },
      data: { reminder2hSentAt: now, reminder24hSentAt: booking.reminder24hSentAt ?? now },
    });

    if (count > 0) {
      sent++;
      await notifyBookingReminder(booking, describeStartsIn(booking.startTime, now));
    }
  }

  const dueTomorrow = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      source: "ONLINE",
      reminder24hSentAt: null,
      startTime: { gt: in2Hours, lte: in24Hours },
    },
    include: bookingPartiesInclude,
    take: BATCH_SIZE,
  });

  for (const booking of dueTomorrow) {
    const { count } = await prisma.booking.updateMany({
      where: { id: booking.id, status: "CONFIRMED", reminder24hSentAt: null },
      data: { reminder24hSentAt: now },
    });

    if (count > 0) {
      sent++;
      await notifyBookingReminder(booking, describeStartsIn(booking.startTime, now));
    }
  }

  return sent;
}

export async function runBookingMaintenance(now = new Date()) {
  const expired = await expireOverdueBookings(now);
  const completed = await completeFinishedBookings(now);
  const reminded = await sendDueReminders(now);
  await expireWaitlist(now);

  if (expired || completed || reminded) {
    logger.info({ expired, completed, reminded }, "Booking maintenance run");
  }

  return { expired, completed, reminded };
}

registerHandler(QUEUES.bookingMaintenance, () => runBookingMaintenance());
