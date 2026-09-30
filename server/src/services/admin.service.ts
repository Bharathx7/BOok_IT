import prisma from "../config/prisma.js";
import { env } from "../config/env.js";
import {
  Prisma,
  type BookingStatus,
  type UserRole,
  type UserStatus,
  type VenueApprovalStatus,
} from "../generated/prisma/client.js";
import { normalizeBookingCode } from "../utils/bookingCode.js";
import { DEFAULT_TIMEZONE, addDaysToKey, zonedTimeToUtc } from "../utils/datetime.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../utils/errors.js";
import {
  buildPaginationMeta,
  type PaginationParams,
} from "../utils/pagination.js";
import { recordAudit } from "./audit.service.js";
import { logoutAll } from "./auth.service.js";
import { queueEmail } from "./email.service.js";
import { notify } from "./notification.service.js";
import { getSettings } from "./settings.service.js";
import { runInBackground } from "../utils/background.js";
import { venueChanged } from "./venueCache.js";

export const getAdminDashboard = async () => {
  const [
    totalUsers,
    totalProviders,
    totalVenues,
    totalBookings,
    pendingBookings,
    confirmedBookings,
    completedBookings,
    cancelledBookings,
    expiredBookings,
    venuesAwaitingApproval,
    flaggedReviews,
    suspendedUsers,
  ] = await Promise.all([
    prisma.user.count({
      where: {
        role: "USER",
      },
    }),

    prisma.user.count({
      where: {
        role: "PROVIDER",
      },
    }),

    prisma.venue.count(),

    prisma.booking.count(),

    prisma.booking.count({
      where: {
        status: "PENDING",
      },
    }),

    prisma.booking.count({
      where: {
        status: "CONFIRMED",
      },
    }),

    prisma.booking.count({
      where: {
        status: "COMPLETED",
      },
    }),

    prisma.booking.count({
      where: {
        status: "CANCELLED",
      },
    }),

    prisma.booking.count({
      where: {
        status: "EXPIRED",
      },
    }),

    prisma.venue.count({ where: { approvalStatus: "PENDING" } }),

    prisma.review.count({ where: { status: "FLAGGED" } }),

    prisma.user.count({ where: { status: { not: "ACTIVE" } } }),
  ]);

  return {
    users: totalUsers,
    providers: totalProviders,
    venues: totalVenues,
    bookings: totalBookings,

    bookingStats: {
      pending: pendingBookings,
      confirmed: confirmedBookings,
      completed: completedBookings,
      cancelled: cancelledBookings,
      expired: expiredBookings,
    },

    // Work waiting for an admin.
    queues: {
      venuesAwaitingApproval,
      flaggedReviews,
      suspendedUsers,
    },
  };
};

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A booking code ("BK-7F3K2Q", "7f3k2q"), a booking id, or part of the customer's email or name. */
function bookingSearch(q: string): Prisma.BookingWhereInput {
  const text = q.trim();
  return {
    OR: [
      ...(UUID.test(text) ? [{ id: text }] : []),
      ...(/^(bk[\s-]?)?[a-z0-9]{6}$/i.test(text) ? [{ bookingCode: normalizeBookingCode(text) }] : []),
      { user: { email: { contains: text, mode: "insensitive" } } },
      { user: { name: { contains: text, mode: "insensitive" } } },
      { guestName: { contains: text, mode: "insensitive" } },
    ],
  };
}

export const getAdminBookings = async (
  pagination: PaginationParams,
  filters: { q?: string | undefined; status?: BookingStatus | undefined; venueId?: string | undefined } = {}
) => {
  const where: Prisma.BookingWhereInput = {
    ...(filters.status && { status: filters.status }),
    ...(filters.venueId && { venueId: filters.venueId }),
    ...(filters.q && bookingSearch(filters.q)),
  };

  const [items, total] = await prisma.$transaction([
    prisma.booking.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
      skip: pagination.skip,
      take: pagination.limit,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        venue: {
          select: {
            id: true,
            name: true,
            timezone: true,
            owner: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        coupon: { select: { code: true } },
      },
    }),
    prisma.booking.count({ where }),
  ]);

  return { items, pagination: buildPaginationMeta(pagination, total) };
};

export const getAdminUsers = async (
  pagination: PaginationParams,
  filters: { role?: UserRole | undefined; status?: UserStatus | undefined; q?: string | undefined } = {}
) => {
  const where: Prisma.UserWhereInput = {
    ...(filters.role && { role: filters.role }),
    ...(filters.status && { status: filters.status }),
    ...(filters.q && {
      OR: [
        { name: { contains: filters.q.trim(), mode: "insensitive" } },
        { email: { contains: filters.q.trim(), mode: "insensitive" } },
      ],
    }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      skip: pagination.skip,
      take: pagination.limit,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { items, pagination: buildPaginationMeta(pagination, total) };
};

export const getAdminVenues = async (
  pagination: PaginationParams,
  filters: { approvalStatus?: VenueApprovalStatus | undefined; q?: string | undefined } = {}
) => {
  const where: Prisma.VenueWhereInput = {
    ...(filters.approvalStatus && { approvalStatus: filters.approvalStatus }),
    ...(filters.q && {
      OR: [
        { name: { contains: filters.q.trim(), mode: "insensitive" } },
        { city: { contains: filters.q.trim(), mode: "insensitive" } },
        { owner: { email: { contains: filters.q.trim(), mode: "insensitive" } } },
      ],
    }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.venue.findMany({
      where,
      skip: pagination.skip,
      take: pagination.limit,
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
          },
        },
        images: {
          orderBy: [{ isCover: "desc" }, { position: "asc" }],
          take: 1,
          select: { url: true },
        },
        _count: {
          select: {
            bookings: true,
            reviews: true,
            availability: true,
          },
        },
      },
      // The approval queue is worked oldest first.
      orderBy: {
        createdAt: filters.approvalStatus === "PENDING" ? "asc" : "desc",
      },
    }),
    prisma.venue.count({ where }),
  ]);

  return { items, pagination: buildPaginationMeta(pagination, total) };
};

// ---------------------------------------------------------------------------
// User detail and account status
// ---------------------------------------------------------------------------

export async function getAdminUserDetail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      avatarUrl: true,
      role: true,
      status: true,
      statusReason: true,
      statusChangedAt: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { bookings: true, reviews: true, ownedVenues: true, reviewReports: true } },
    },
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  const now = new Date();

  const [recentBookings, upcomingBookings, venues, activeSessions, history, actionsTaken] = await Promise.all([
    prisma.booking.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        bookingCode: true,
        status: true,
        source: true,
        startTime: true,
        endTime: true,
        totalPrice: true,
        venue: { select: { id: true, name: true, timezone: true } },
      },
    }),
    prisma.booking.count({ where: { userId, status: { in: ["PENDING", "CONFIRMED"] }, startTime: { gt: now } } }),
    prisma.venue.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, city: true, isActive: true, approvalStatus: true, _count: { select: { bookings: true } } },
    }),
    prisma.refreshToken.count({ where: { userId, revokedAt: null, expiresAt: { gt: now } } }),
    prisma.auditLog.findMany({
      where: { entityType: "User", entityId: userId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { actor: { select: { id: true, name: true } } },
    }),
    user.role === "ADMIN"
      ? prisma.auditLog.findMany({
          where: { actorId: userId },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, action: true, entityType: true, entityId: true, createdAt: true },
        })
      : Promise.resolve([]),
  ]);

  return { user, recentBookings, upcomingBookings, venues, activeSessions, history, actionsTaken };
}

const STATUS_ACTIONS: Record<UserStatus, string> = {
  ACTIVE: "user.reactivated",
  SUSPENDED: "user.suspended",
  BANNED: "user.banned",
};

/**
 * Suspends, bans or reactivates an account. Suspended and banned users are
 * signed out everywhere at once (every request re-checks the status too),
 * and their venues disappear from search until they're active again.
 */
export async function setUserStatus(
  userId: string,
  status: UserStatus,
  reason: string | null,
  actor: { id: string }
) {
  if (userId === actor.id) {
    throw new ForbiddenError("You can't change the status of your own account");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  if (user.role === "ADMIN") {
    throw new ForbiddenError("Admin accounts can't be suspended or banned");
  }

  if (user.status === status) {
    throw new ConflictError(`This account is already ${status.toLowerCase()}`);
  }

  if (status !== "ACTIVE" && !reason) {
    throw new ValidationError("Give a reason", [{ field: "reason", message: "Required when suspending or banning" }]);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: userId },
      data: { status, statusReason: status === "ACTIVE" ? null : reason, statusChangedAt: new Date() },
      select: { id: true, status: true, statusReason: true, statusChangedAt: true },
    });

    await recordAudit(
      {
        action: STATUS_ACTIONS[status],
        entityType: "User",
        entityId: userId,
        before: { status: user.status, statusReason: user.statusReason },
        after: { status, statusReason: result.statusReason },
        reason,
      },
      tx
    );

    return result;
  });

  if (status !== "ACTIVE") {
    await logoutAll(userId);
  }
  // A provider's venues appear or disappear with their account.
  if (user.role === "PROVIDER") venueChanged();

  runInBackground("account status email", () =>
    queueEmail(
      user.email,
      status === "ACTIVE" ? "BookIt - your account is active again" : `BookIt - your account has been ${status === "BANNED" ? "banned" : "suspended"}`,
      status === "ACTIVE"
        ? {
            preview: "You can sign in again.",
            heading: "Your account is active again",
            greeting: `Hello ${user.name},`,
            paragraphs: ["An administrator has reactivated your BookIt account. You can sign in and use it as before."],
            button: { label: "Sign in", url: `${env.APP_URL}/login` },
          }
        : {
            preview: `Your account has been ${status === "BANNED" ? "banned" : "suspended"}.`,
            heading: status === "BANNED" ? "Your account has been banned" : "Your account has been suspended",
            greeting: `Hello ${user.name},`,
            paragraphs: [
              status === "BANNED"
                ? "An administrator has banned your BookIt account. You can no longer sign in."
                : "An administrator has suspended your BookIt account. You can't sign in until it is reactivated.",
              ...(reason ? [`Reason: ${reason}`] : []),
              "If you think this is a mistake, reply to this email.",
            ],
          }
    )
  );

  return updated;
}

// ---------------------------------------------------------------------------
// Venue approval
// ---------------------------------------------------------------------------

export async function reviewVenue(
  venueId: string,
  decision: "APPROVED" | "REJECTED",
  reason: string | null
) {
  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    include: { owner: { select: { id: true, name: true, email: true } } },
  });

  if (!venue) {
    throw new NotFoundError("Venue not found");
  }

  if (decision === "REJECTED" && !reason) {
    throw new ValidationError("Tell the owner what to fix", [{ field: "reason", message: "Required when rejecting" }]);
  }

  if (venue.approvalStatus === decision) {
    throw new ConflictError(`This venue is already ${decision.toLowerCase()}`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.venue.update({
      where: { id: venueId },
      data: {
        approvalStatus: decision,
        rejectionReason: decision === "REJECTED" ? reason : null,
        reviewedAt: new Date(),
      },
    });

    await recordAudit(
      {
        action: decision === "APPROVED" ? "venue.approved" : "venue.rejected",
        entityType: "Venue",
        entityId: venueId,
        before: { approvalStatus: venue.approvalStatus, rejectionReason: venue.rejectionReason },
        after: { approvalStatus: decision, rejectionReason: result.rejectionReason },
        reason,
      },
      tx
    );

    return result;
  });

  venueChanged(venueId);
  const approved = decision === "APPROVED";
  const editUrl = `${env.APP_URL}/provider/venues/${venueId}/edit`;

  runInBackground("venue review notification", () =>
    notify({
      userId: venue.owner.id,
      type: "VENUE_REVIEWED",
      title: approved ? "Venue approved" : "Venue needs changes",
      body: approved
        ? `${venue.name} is approved and now visible to customers.`
        : `${venue.name} wasn't approved: ${reason}. Edit it to send it for review again.`,
      data: { venueId },
      email: {
        to: venue.owner.email,
        subject: approved ? `BookIt - ${venue.name} is live` : `BookIt - ${venue.name} needs changes`,
        content: {
          preview: approved ? "Customers can now find and book it." : "Edit the listing to send it again.",
          heading: approved ? "Your venue is approved" : "Your venue needs changes",
          greeting: `Hello ${venue.owner.name},`,
          paragraphs: approved
            ? [`${venue.name} has been approved and is now visible to customers${venue.isActive ? "" : " once you list it"}.`]
            : [`${venue.name} wasn't approved yet.`, `What to fix: ${reason}`, "Editing the venue sends it back for review."],
          button: { label: approved ? "View your venue" : "Edit venue", url: editUrl },
        },
      },
    })
  );

  return updated;
}

// ---------------------------------------------------------------------------
// Search across everything
// ---------------------------------------------------------------------------

export async function adminSearch(q: string) {
  const text = q.trim();

  if (text.length < 2) {
    throw new ValidationError("Type at least 2 characters");
  }

  const [users, venues, bookings] = await Promise.all([
    prisma.user.findMany({
      where: {
        OR: [
          ...(UUID.test(text) ? [{ id: text }] : []),
          { name: { contains: text, mode: "insensitive" } },
          { email: { contains: text, mode: "insensitive" } },
        ],
      },
      take: 6,
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, email: true, role: true, status: true },
    }),
    prisma.venue.findMany({
      where: {
        OR: [
          ...(UUID.test(text) ? [{ id: text }] : []),
          { name: { contains: text, mode: "insensitive" } },
          { city: { contains: text, mode: "insensitive" } },
        ],
      },
      take: 6,
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, city: true, approvalStatus: true, isActive: true },
    }),
    prisma.booking.findMany({
      where: bookingSearch(text),
      take: 6,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        bookingCode: true,
        status: true,
        startTime: true,
        user: { select: { name: true, email: true } },
        venue: { select: { name: true, timezone: true } },
      },
    }),
  ]);

  return { users, venues, bookings };
}

// ---------------------------------------------------------------------------
// Platform analytics
// ---------------------------------------------------------------------------

const MAX_RANGE_DAYS = 366;
const COHORT_MONTHS = 6;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** A JS instant as the stored UTC "timestamp without time zone". */
const utcTs = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** Stored UTC timestamp column -> local wall-clock timestamp in `tz`. */
const local = (column: Prisma.Sql, tz: string) => Prisma.sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})`;

const EARNED = Prisma.sql`b."status" IN ('CONFIRMED', 'COMPLETED')`;

/**
 * Platform report for [from, to] (dates in the platform timezone, by the day
 * a booking was made). GMV is what confirmed and completed bookings are
 * worth after discounts; blocked time is left out, walk-ins count.
 */
export async function getPlatformAnalytics(range: { from: string; to: string }) {
  const tz = DEFAULT_TIMEZONE;
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;

  if (!Number.isFinite(days) || days < 1 || days > MAX_RANGE_DAYS) {
    throw new ValidationError(`Choose a range of 1 to ${MAX_RANGE_DAYS} days`);
  }

  const start = zonedTimeToUtc(range.from, "00:00", tz);
  const end = zonedTimeToUtc(addDaysToKey(range.to, 1), "00:00", tz);
  const inRange = Prisma.sql`b."createdAt" >= ${utcTs(start)} AND b."createdAt" < ${utcTs(end)} AND b."source" <> 'BLOCK'`;

  const [settings, daily, statusRows, totals, topVenues, topCities, newUsers, newProviders, newVenues] = await Promise.all([
    getSettings(),
    prisma.$queryRaw<{ day: string; bookings: number; gmv: number }[]>`
      SELECT to_char(${local(Prisma.sql`b."createdAt"`, tz)}, 'YYYY-MM-DD') AS day,
             count(*)::int AS bookings,
             COALESCE(sum(b."totalPrice") FILTER (WHERE ${EARNED}), 0)::float8 AS gmv
      FROM "Booking" b
      WHERE ${inRange}
      GROUP BY 1
    `,
    prisma.$queryRaw<{ status: BookingStatus; count: number }[]>`
      SELECT b."status", count(*)::int AS count
      FROM "Booking" b
      WHERE ${inRange} AND b."source" = 'ONLINE'
      GROUP BY b."status"
    `,
    prisma.$queryRaw<{ gmv: number; online_gmv: number; discounts: number; walk_ins: number; coupon_bookings: number }[]>`
      SELECT COALESCE(sum(b."totalPrice") FILTER (WHERE ${EARNED}), 0)::float8 AS gmv,
             COALESCE(sum(b."totalPrice") FILTER (WHERE ${EARNED} AND b."source" = 'ONLINE'), 0)::float8 AS online_gmv,
             COALESCE(sum(b."discountAmount") FILTER (WHERE ${EARNED}), 0)::float8 AS discounts,
             count(*) FILTER (WHERE b."source" = 'WALK_IN')::int AS walk_ins,
             count(*) FILTER (WHERE b."couponId" IS NOT NULL AND ${EARNED})::int AS coupon_bookings
      FROM "Booking" b
      WHERE ${inRange}
    `,
    prisma.$queryRaw<{ id: string; name: string; city: string | null; bookings: number; gmv: number }[]>`
      SELECT v.id, v."name", v."city",
             count(*) FILTER (WHERE ${EARNED})::int AS bookings,
             COALESCE(sum(b."totalPrice") FILTER (WHERE ${EARNED}), 0)::float8 AS gmv
      FROM "Booking" b JOIN "Venue" v ON v.id = b."venueId"
      WHERE ${inRange}
      GROUP BY v.id
      HAVING count(*) FILTER (WHERE ${EARNED}) > 0
      ORDER BY gmv DESC, bookings DESC
      LIMIT 10
    `,
    prisma.$queryRaw<{ city: string; venues: number; bookings: number; gmv: number }[]>`
      SELECT COALESCE(NULLIF(initcap(trim(v."city")), ''), 'Unknown') AS city,
             count(DISTINCT v.id)::int AS venues,
             count(*) FILTER (WHERE ${EARNED})::int AS bookings,
             COALESCE(sum(b."totalPrice") FILTER (WHERE ${EARNED}), 0)::float8 AS gmv
      FROM "Booking" b JOIN "Venue" v ON v.id = b."venueId"
      WHERE ${inRange}
      GROUP BY 1
      HAVING count(*) FILTER (WHERE ${EARNED}) > 0
      ORDER BY gmv DESC, bookings DESC
      LIMIT 10
    `,
    prisma.user.count({ where: { role: "USER", createdAt: { gte: start, lt: end } } }),
    prisma.user.count({ where: { role: "PROVIDER", createdAt: { gte: start, lt: end } } }),
    prisma.venue.count({ where: { createdAt: { gte: start, lt: end } } }),
  ]);

  // Every day of the range, including quiet ones.
  const byDay = new Map(daily.map((row) => [row.day, row]));
  const series = Array.from({ length: days }, (_, i) => {
    const date = addDaysToKey(range.from, i);
    const row = byDay.get(date);
    return { date, bookings: row?.bookings ?? 0, gmv: round2(row?.gmv ?? 0) };
  });

  const byStatus = Object.fromEntries(statusRows.map((row) => [row.status, row.count])) as Partial<Record<BookingStatus, number>>;
  const requests = statusRows.reduce((sum, row) => sum + row.count, 0);
  const converted = (byStatus.CONFIRMED ?? 0) + (byStatus.COMPLETED ?? 0);
  const total = totals[0] ?? { gmv: 0, online_gmv: 0, discounts: 0, walk_ins: 0, coupon_bookings: 0 };
  const percent = (part: number) => (requests > 0 ? Math.round((part / requests) * 1000) / 10 : 0);

  return {
    range: { from: range.from, to: range.to, days, timezone: tz },
    summary: {
      gmv: round2(total.gmv),
      bookings: series.reduce((sum, day) => sum + day.bookings, 0),
      averageBookingValue: converted + total.walk_ins > 0 ? round2(total.gmv / Math.max(1, converted + total.walk_ins)) : 0,
      commissionPercent: settings.commissionPercent,
      // Walk-ins are paid at the venue, so only online bookings earn commission.
      estimatedCommission: round2((total.online_gmv * settings.commissionPercent) / 100),
      discounts: round2(total.discounts),
      couponBookings: total.coupon_bookings,
      walkIns: total.walk_ins,
      newUsers,
      newProviders,
      newVenues,
    },
    conversion: {
      requests,
      converted,
      conversionPercent: percent(converted),
      cancelledPercent: percent(byStatus.CANCELLED ?? 0),
      expiredPercent: percent(byStatus.EXPIRED ?? 0),
      pending: byStatus.PENDING ?? 0,
      byStatus,
    },
    daily: series,
    topVenues: topVenues.map((row) => ({ ...row, gmv: round2(row.gmv) })),
    topCities: topCities.map((row) => ({ ...row, gmv: round2(row.gmv) })),
    cohorts: await getCohortRetention(range.to, tz, end),
  };
}

/**
 * Customers grouped by the month they signed up (the last six months up to
 * `to`); for each later month, the share who made at least one online booking.
 */
async function getCohortRetention(to: string, tz: string, end: Date) {
  const [year, month] = to.split("-").map(Number) as [number, number];
  const monthKey = (offset: number) => {
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const months = Array.from({ length: COHORT_MONTHS }, (_, i) => monthKey(i - (COHORT_MONTHS - 1)));
  const cohortStart = zonedTimeToUtc(`${months[0]}-01`, "00:00", tz);

  const signupMonth = Prisma.sql`to_char(${local(Prisma.sql`u."createdAt"`, tz)}, 'YYYY-MM')`;

  const [sizes, activity] = await Promise.all([
    prisma.$queryRaw<{ cohort: string; users: number }[]>`
      SELECT ${signupMonth} AS cohort, count(*)::int AS users
      FROM "User" u
      WHERE u."role" = 'USER' AND u."createdAt" >= ${utcTs(cohortStart)} AND u."createdAt" < ${utcTs(end)}
      GROUP BY 1
    `,
    prisma.$queryRaw<{ cohort: string; active_month: string; users: number }[]>`
      SELECT ${signupMonth} AS cohort,
             to_char(${local(Prisma.sql`b."createdAt"`, tz)}, 'YYYY-MM') AS active_month,
             count(DISTINCT u.id)::int AS users
      FROM "User" u JOIN "Booking" b ON b."userId" = u.id AND b."source" = 'ONLINE'
      WHERE u."role" = 'USER' AND u."createdAt" >= ${utcTs(cohortStart)} AND u."createdAt" < ${utcTs(end)}
        AND b."createdAt" >= u."createdAt" AND b."createdAt" < ${utcTs(end)}
      GROUP BY 1, 2
    `,
  ]);

  const sizeOf = new Map(sizes.map((row) => [row.cohort, row.users]));
  const activeOf = new Map(activity.map((row) => [`${row.cohort}:${row.active_month}`, row.users]));

  return months.map((cohort, index) => {
    const users = sizeOf.get(cohort) ?? 0;
    // Month 0 is the signup month; later months that haven't happened yet are null.
    const retention = months.slice(index).map((activeMonth) => {
      const active = activeOf.get(`${cohort}:${activeMonth}`) ?? 0;
      return users > 0 ? Math.round((active / users) * 1000) / 10 : 0;
    });
    return { cohort, users, retention };
  });
}
