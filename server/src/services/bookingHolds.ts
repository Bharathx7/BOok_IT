import { Prisma } from "../generated/prisma/client.js";

// Which bookings occupy their time. Must match the statuses in the
// "Booking_no_overlap" exclusion constraint (migration payments_holds).

export const HOLDING_STATUSES = ["AWAITING_PAYMENT", "PENDING", "CONFIRMED"] as const;

/** Statuses that expire at expiresAt: unconfirmed requests and unpaid bookings. */
export const EXPIRING_STATUSES = ["AWAITING_PAYMENT", "PENDING"] as const;

/** Bookings holding their time right now: confirmed, or waiting and not yet past their hold. */
export const holdsTimeWhere = (now: Date) =>
  ({
    OR: [
      { status: "CONFIRMED" },
      { status: { in: [...EXPIRING_STATUSES] }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    ],
  }) satisfies Prisma.BookingWhereInput;

/** The same test in SQL, for a booking aliased as `alias`. */
export const holdsTimeSql = (alias: string, now: Prisma.Sql) => {
  const b = Prisma.raw(`${alias}."status"`);
  const expires = Prisma.raw(`${alias}."expiresAt"`);
  return Prisma.sql`(${b} = 'CONFIRMED' OR (${b} IN ('AWAITING_PAYMENT', 'PENDING') AND (${expires} IS NULL OR ${expires} > ${now})))`;
};
