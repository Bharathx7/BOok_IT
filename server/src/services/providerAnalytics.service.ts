import prisma from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import {
  DEFAULT_TIMEZONE,
  addDaysToKey,
  localParts,
  zonedTimeToUtc,
} from "../utils/datetime.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";

// Provider reports. Blocked time never counts as a booking or revenue;
// walk-ins do. Revenue is what confirmed and completed bookings are worth
// (payments arrive in Phase 8). Dates are the venue's local dates.

const HOUR = 3_600_000;
const STEP = 15 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

const EARNING = new Set(["CONFIRMED", "COMPLETED"]);

export interface AnalyticsRange {
  from: string;
  to: string;
  venueId?: string | undefined;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

function dayCount(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

async function venuesInScope(ownerId: string, venueId?: string) {
  const venues = await prisma.venue.findMany({
    where: { ownerId, ...(venueId && { id: venueId }) },
    select: { id: true, name: true, timezone: true },
  });

  if (venueId && venues.length === 0) {
    throw new NotFoundError("Venue not found");
  }

  return venues;
}

function utcRange(range: AnalyticsRange, timeZone: string) {
  const days = dayCount(range.from, range.to);

  if (days < 1 || days > MAX_RANGE_DAYS) {
    throw new ValidationError(`Choose a range of 1 to ${MAX_RANGE_DAYS} days`);
  }

  return {
    days,
    start: zonedTimeToUtc(range.from, "00:00", timeZone),
    end: zonedTimeToUtc(addDaysToKey(range.to, 1), "00:00", timeZone),
  };
}

/** Calls fn for every 15-minute step of [start, end) clipped to [min, max). */
function eachStep(start: Date, end: Date, min: Date, max: Date, fn: (at: Date) => void) {
  const from = Math.max(start.getTime(), min.getTime());
  const to = Math.min(end.getTime(), max.getTime());
  for (let t = from; t < to; t += STEP) fn(new Date(t));
}

export async function getProviderAnalytics(ownerId: string, range: AnalyticsRange) {
  const venues = await venuesInScope(ownerId, range.venueId);
  const timeZone = venues[0]?.timezone ?? DEFAULT_TIMEZONE;
  const { start, end } = utcRange(range, timeZone);
  const venueIds = venues.map((venue) => venue.id);
  const tzOf = new Map(venues.map((venue) => [venue.id, venue.timezone]));

  const [bookings, slots, reviews] = await Promise.all([
    prisma.booking.findMany({
      where: { venueId: { in: venueIds }, startTime: { gte: start, lt: end } },
      select: {
        venueId: true,
        userId: true,
        status: true,
        source: true,
        startTime: true,
        endTime: true,
        totalPrice: true,
        guestName: true,
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.timeSlot.findMany({
      where: { venueId: { in: venueIds }, startTime: { lt: end }, endTime: { gt: start } },
      select: { venueId: true, startTime: true, endTime: true },
    }),
    // Rating trend always looks back 12 months from the end of the range.
    prisma.review.findMany({
      where: {
        venueId: { in: venueIds },
        createdAt: { gte: new Date(end.getTime() - 366 * 24 * HOUR), lt: end },
      },
      select: { rating: true, createdAt: true },
    }),
  ]);

  const counted = bookings.filter((booking) => booking.source !== "BLOCK");
  const earning = counted.filter((booking) => EARNING.has(booking.status));

  // Daily revenue and bookings, one row per day even when empty.
  const daily = new Map<string, { date: string; revenue: number; bookings: number }>();
  for (let offset = 0; offset < dayCount(range.from, range.to); offset++) {
    const date = addDaysToKey(range.from, offset);
    daily.set(date, { date, revenue: 0, bookings: 0 });
  }

  for (const booking of counted) {
    const row = daily.get(localParts(booking.startTime, tzOf.get(booking.venueId)!).dateKey);
    if (!row) continue;
    row.bookings++;
    if (EARNING.has(booking.status)) row.revenue += Number(booking.totalPrice ?? 0);
  }

  // Weekday x hour heatmap of booked vs open hours.
  const cells = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ bookedHours: 0, openHours: 0 }))
  );

  for (const slot of slots) {
    const tz = tzOf.get(slot.venueId)!;
    eachStep(slot.startTime, slot.endTime, start, end, (at) => {
      const local = localParts(at, tz);
      cells[local.weekday]![local.hour]!.openHours += 0.25;
    });
  }

  let bookedHours = 0;
  for (const booking of earning) {
    const tz = tzOf.get(booking.venueId)!;
    eachStep(booking.startTime, booking.endTime, start, end, (at) => {
      const local = localParts(at, tz);
      cells[local.weekday]![local.hour]!.bookedHours += 0.25;
      bookedHours += 0.25;
    });
  }

  const openHours = slots.reduce((sum, slot) => {
    const from = Math.max(slot.startTime.getTime(), start.getTime());
    const to = Math.min(slot.endTime.getTime(), end.getTime());
    return sum + Math.max(0, to - from) / HOUR;
  }, 0);

  // Best customers: online bookings that weren't cancelled or expired.
  const customers = new Map<string, { name: string; email: string; bookings: number; spent: number }>();
  for (const booking of earning.filter((b) => b.source === "ONLINE")) {
    const entry = customers.get(booking.userId) ?? {
      name: booking.user.name,
      email: booking.user.email,
      bookings: 0,
      spent: 0,
    };
    entry.bookings++;
    entry.spent += Number(booking.totalPrice ?? 0);
    customers.set(booking.userId, entry);
  }

  const months = new Map<string, { month: string; total: number; count: number }>();
  for (const review of reviews) {
    const month = localParts(review.createdAt, timeZone).dateKey.slice(0, 7);
    const entry = months.get(month) ?? { month, total: 0, count: 0 };
    entry.total += review.rating;
    entry.count++;
    months.set(month, entry);
  }

  const byStatus = counted.reduce<Record<string, number>>((totals, booking) => {
    totals[booking.status] = (totals[booking.status] ?? 0) + 1;
    return totals;
  }, {});

  const revenue = earning.reduce((sum, booking) => sum + Number(booking.totalPrice ?? 0), 0);
  const cancelled = byStatus.CANCELLED ?? 0;

  const perVenue = venues.map((venue) => {
    const mine = earning.filter((booking) => booking.venueId === venue.id);
    const venueOpen = slots
      .filter((slot) => slot.venueId === venue.id)
      .reduce((sum, slot) => {
        const from = Math.max(slot.startTime.getTime(), start.getTime());
        const to = Math.min(slot.endTime.getTime(), end.getTime());
        return sum + Math.max(0, to - from) / HOUR;
      }, 0);
    const venueBooked = mine.reduce(
      (sum, booking) =>
        sum +
        Math.max(0, Math.min(booking.endTime.getTime(), end.getTime()) - booking.startTime.getTime()) / HOUR,
      0
    );

    return {
      venueId: venue.id,
      name: venue.name,
      revenue: round2(mine.reduce((sum, booking) => sum + Number(booking.totalPrice ?? 0), 0)),
      bookings: counted.filter((booking) => booking.venueId === venue.id).length,
      occupancyPercent: venueOpen > 0 ? round1((venueBooked / venueOpen) * 100) : 0,
    };
  });

  return {
    range: { from: range.from, to: range.to, timeZone },
    summary: {
      revenue: round2(revenue),
      bookings: counted.length,
      walkIns: counted.filter((booking) => booking.source === "WALK_IN").length,
      averageBookingValue: earning.length ? round2(revenue / earning.length) : 0,
      bookedHours: round1(bookedHours),
      openHours: round1(openHours),
      occupancyPercent: openHours > 0 ? round1((bookedHours / openHours) * 100) : 0,
      cancellationRatePercent: counted.length ? round1((cancelled / counted.length) * 100) : 0,
      byStatus,
    },
    daily: [...daily.values()].map((row) => ({ ...row, revenue: round2(row.revenue) })),
    heatmap: cells.flatMap((hours, weekday) =>
      hours.map((cell, hour) => ({
        weekday,
        hour,
        bookedHours: round2(cell.bookedHours),
        openHours: round2(cell.openHours),
      }))
    ),
    topCustomers: [...customers.values()]
      .sort((a, b) => b.spent - a.spent || b.bookings - a.bookings)
      .slice(0, 5)
      .map((customer) => ({ ...customer, spent: round2(customer.spent) })),
    ratingTrend: [...months.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(({ month, total, count }) => ({ month, averageRating: round2(total / count), reviews: count })),
    perVenue,
  };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

/**
 * Quotes a CSV cell and defuses spreadsheet formulas: values starting with
 * = + - @ (or tab/CR) are prefixed with a quote so Excel shows them as text.
 */
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

const localDateTime = (date: Date, timeZone: string) => {
  const parts = localParts(date, timeZone);
  const hh = String(Math.floor(parts.minutes / 60)).padStart(2, "0");
  const mm = String(parts.minutes % 60).padStart(2, "0");
  return { date: parts.dateKey, time: `${hh}:${mm}` };
};

export async function exportBookingsCsv(ownerId: string, range: AnalyticsRange) {
  const venues = await venuesInScope(ownerId, range.venueId);
  const timeZone = venues[0]?.timezone ?? DEFAULT_TIMEZONE;
  const { start, end } = utcRange(range, timeZone);

  const bookings = await prisma.booking.findMany({
    where: { venueId: { in: venues.map((venue) => venue.id) }, startTime: { gte: start, lt: end } },
    orderBy: { startTime: "asc" },
    include: {
      venue: { select: { name: true, timezone: true } },
      user: { select: { name: true, email: true, phone: true } },
    } satisfies Prisma.BookingInclude,
  });

  const header = [
    "Booking ID",
    "Venue",
    "Type",
    "Status",
    "Date",
    "Start",
    "End",
    "Hours",
    "Customer",
    "Email",
    "Phone",
    "Price (INR)",
    "Refund %",
    "Refund (INR)",
    "Note",
    "Booked at",
  ];

  const rows = bookings.map((booking) => {
    const startLocal = localDateTime(booking.startTime, booking.venue.timezone);
    const endLocal = localDateTime(booking.endTime, booking.venue.timezone);
    const isOnline = booking.source === "ONLINE";

    return [
      booking.id,
      booking.venue.name,
      booking.source === "WALK_IN" ? "Walk-in" : booking.source === "BLOCK" ? "Blocked" : "Online",
      booking.status,
      startLocal.date,
      startLocal.time,
      endLocal.time,
      round2((booking.endTime.getTime() - booking.startTime.getTime()) / HOUR),
      isOnline ? booking.user.name : booking.guestName ?? "",
      isOnline ? booking.user.email : "",
      isOnline ? booking.user.phone ?? "" : booking.guestPhone ?? "",
      booking.totalPrice === null ? "" : Number(booking.totalPrice).toFixed(2),
      booking.refundPercent ?? "",
      booking.refundAmount === null ? "" : Number(booking.refundAmount).toFixed(2),
      booking.note ?? "",
      booking.createdAt.toISOString(),
    ];
  });

  // BOM so Excel opens UTF-8 (₹, names) correctly.
  return "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

/** Everything the owner's week/day calendar shows for one venue. */
export async function getProviderCalendar(ownerId: string, venueId: string, from: string, to: string) {
  const [venue] = await venuesInScope(ownerId, venueId);
  const { start, end, days } = utcRange({ from, to }, venue!.timezone);

  if (days > 31) {
    throw new ValidationError("Show at most 31 days at a time");
  }

  const [slots, bookings, blackouts] = await Promise.all([
    prisma.timeSlot.findMany({
      where: { venueId, startTime: { lt: end }, endTime: { gt: start } },
      orderBy: { startTime: "asc" },
      select: { id: true, startTime: true, endTime: true },
    }),
    prisma.booking.findMany({
      where: {
        venueId,
        startTime: { lt: end },
        endTime: { gt: start },
        status: { in: ["PENDING", "CONFIRMED", "COMPLETED"] },
      },
      orderBy: { startTime: "asc" },
      select: {
        id: true,
        status: true,
        source: true,
        startTime: true,
        endTime: true,
        expiresAt: true,
        totalPrice: true,
        guestName: true,
        guestPhone: true,
        note: true,
        user: { select: { name: true, email: true, phone: true } },
      },
    }),
    prisma.blackoutDate.findMany({
      where: { venueId, startTime: { lt: end }, endTime: { gt: start } },
      select: { id: true, startTime: true, endTime: true, reason: true },
    }),
  ]);

  return {
    venue: { id: venue!.id, name: venue!.name, timezone: venue!.timezone },
    slots,
    blackouts,
    bookings: bookings.map(({ user, ...booking }) => ({
      ...booking,
      // Walk-ins and blocks are entered by the owner, so show the guest instead.
      customer:
        booking.source === "ONLINE"
          ? { name: user.name, email: user.email, phone: user.phone }
          : booking.source === "WALK_IN"
            ? { name: booking.guestName ?? "Walk-in", email: null, phone: booking.guestPhone }
            : null,
    })),
  };
}
