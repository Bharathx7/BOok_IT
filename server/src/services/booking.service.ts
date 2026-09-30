import prisma from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { emitBookingEvent } from "../sockets/socket.js";
import { runInBackground } from "../utils/background.js";
import {
  announceExpiredBookings,
  bookingPartiesInclude,
} from "./bookingLifecycle.service.js";
import {
  notifyBookingCancelled,
  notifyBookingCompleted,
  notifyBookingConfirmed,
  notifyBookingRequested,
  notifyOwnerPaidBooking,
} from "./bookingNotifications.service.js";
import {
  enqueueRefund,
  isFreeAmount,
  paidPaise,
  paymentHoldUntil,
  paysOnline,
  refundForCancellation,
  startPayment,
  toPaise,
} from "./payment.service.js";
import { isExclusionViolation } from "../utils/dbErrors.js";
import { quoteRefund } from "./cancellation.service.js";
import { calculatePrice, toPriceRule } from "./pricing.service.js";
import { findBlackoutOverlap } from "./venueTools.service.js";
import { newBookingCode } from "../utils/bookingCode.js";
import { markWaitlistBooked, processWaitlist } from "./waitlist.service.js";
import { checkCoupon, lockCoupon } from "./coupon.service.js";
import { isPublicVenue } from "./venueVisibility.js";
import { recordAudit } from "./audit.service.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors.js";
import {
  buildPaginationMeta,
  type PaginationParams,
} from "../utils/pagination.js";
import { EXPIRING_STATUSES, HOLDING_STATUSES } from "./bookingHolds.js";

interface CreateBookingInput {
  userId: string;
  venueId: string;
  startTime: Date;
  endTime: Date;
  couponCode?: string | undefined;
}

export interface ManualBookingInput {
  venueId: string;
  startTime: Date;
  endTime: Date;
  /** WALK_IN: a customer who booked in person or by phone. BLOCK: time the owner takes out. */
  kind: "WALK_IN" | "BLOCK";
  guestName?: string | null | undefined;
  guestPhone?: string | null | undefined;
  note?: string | null | undefined;
  /** Walk-ins only: overrides the calculated price. */
  price?: number | undefined;
}

const bookingUserSelect = {
  id: true,
  name: true,
  email: true,
} satisfies Prisma.UserSelect;

export type Tx = Prisma.TransactionClient;

/** Requests for one venue queue on its lock; give them room on a slow database. */
const BOOKING_TX = { maxWait: 10_000, timeout: 15_000 };
export type VenueWithRules = Prisma.VenueGetPayload<{
  include: { pricingRules: true; owner: { select: { status: true } } };
}>;

/**
 * Runs `insert` with the venue locked, after releasing overdue requests and
 * checking that nothing active overlaps. Requests for the same venue take
 * turns: without the lock, simultaneous overlapping inserts can deadlock on
 * the exclusion constraint (Postgres aborts one with a 500) instead of
 * cleanly returning 409. The "Booking_no_overlap" constraint remains the
 * final guarantee.
 */
export async function insertBookingLocked<T>(
  venueId: string,
  startTime: Date,
  endTime: Date,
  insert: (tx: Tx, venue: VenueWithRules) => Promise<T>,
  /** Runs inside the lock before the overlap check (e.g. releasing a booking being moved). */
  prepare?: (tx: Tx) => Promise<void>
) {
  let releasedIds: string[] = [];

  try {
    const booking = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${venueId}, 0))`;

      const venue = await tx.venue.findUnique({
        where: { id: venueId },
        include: { pricingRules: { where: { isActive: true } }, owner: { select: { status: true } } },
      });

      if (!venue) {
        throw new NotFoundError("Venue not found");
      }

      if (prepare) await prepare(tx);

      // Requests the owner didn't confirm in time (and bookings not paid in
      // time) no longer hold the slot, even if the every-minute expiry job
      // hasn't reached them yet.
      const overdue = await tx.booking.findMany({
        where: {
          venueId,
          status: { in: [...EXPIRING_STATUSES] },
          expiresAt: { lte: new Date() },
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
        select: { id: true },
      });

      if (overdue.length > 0) {
        releasedIds = overdue.map(({ id }) => id);
        await tx.booking.updateMany({
          where: { id: { in: releasedIds }, status: { in: [...EXPIRING_STATUSES] } },
          data: { status: "EXPIRED" },
        });
      }

      const overlappingBooking = await tx.booking.findFirst({
        where: {
          venueId,
          status: { in: [...HOLDING_STATUSES] },
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      });

      if (overlappingBooking) {
        throw new ConflictError("This time is already booked");
      }

      return insert(tx, venue);
    }, BOOKING_TX);

    return { booking, releasedIds };
  } catch (error) {
    if (isExclusionViolation(error)) {
      throw new ConflictError("This time is already booked");
    }

    throw error;
  }
}

export const priceFor = (venue: VenueWithRules, startTime: Date, endTime: Date) =>
  calculatePrice(
    Number(venue.pricePerHour),
    venue.pricingRules.map(toPriceRule),
    startTime,
    endTime,
    venue.timezone
  );

/**
 * The rules an online booking must follow: the venue's booking step and
 * maximum length, inside an opening slot, not during a closure.
 */
export async function assertBookableTime(
  client: Pick<Tx, "timeSlot" | "blackoutDate">,
  venue: Pick<VenueWithRules, "id" | "slotMinutes" | "maxBookingMinutes">,
  startTime: Date,
  endTime: Date
) {
  const minutes = (endTime.getTime() - startTime.getTime()) / 60_000;

  if (minutes % venue.slotMinutes !== 0 || minutes < venue.slotMinutes) {
    throw new ValidationError(`Bookings at this venue are made in steps of ${venue.slotMinutes} minutes`);
  }

  if (minutes > venue.maxBookingMinutes) {
    throw new ValidationError(
      `Bookings at this venue can be at most ${venue.maxBookingMinutes / 60} hours long`
    );
  }

  const timeSlot = await client.timeSlot.findFirst({
    where: { venueId: venue.id, startTime: { lte: startTime }, endTime: { gte: endTime } },
  });

  if (!timeSlot) {
    throw new ValidationError("Venue is not available for this time");
  }

  const blackout = await findBlackoutOverlap(venue.id, startTime, endTime, client);

  if (blackout) {
    throw new ConflictError(
      `The venue is closed at this time${blackout.reason ? ` (${blackout.reason})` : ""}`
    );
  }
}

/** The owner has pendingHoldMinutes to confirm, but never past the start. */
export const holdUntil = (venue: Pick<VenueWithRules, "pendingHoldMinutes">, startTime: Date) =>
  new Date(Math.min(Date.now() + venue.pendingHoldMinutes * 60 * 1000, startTime.getTime()));

export const createBooking = async (
  { userId, venueId, startTime, endTime, couponCode }: CreateBookingInput,
  options: { recurringGroupId?: string | undefined; notify?: boolean | undefined } = {}
) => {
  if (startTime >= endTime) {
    throw new ValidationError("Start time must be before end time");
  }

  if (startTime <= new Date()) {
    throw new ValidationError("Cannot book a time in the past");
  }

  const { booking, releasedIds } = await insertBookingLocked(venueId, startTime, endTime, async (tx, venue) => {
    // Hidden, unapproved or suspended owners' venues can't take bookings.
    if (!isPublicVenue(venue)) throw new NotFoundError("Venue not found");
    await assertBookableTime(tx, venue, startTime, endTime);
    const price = priceFor(venue, startTime, endTime);

    let discount: { couponId: string; amount: number } | null = null;
    if (couponCode) {
      await lockCoupon(tx, couponCode);
      const checked = await checkCoupon(tx, { code: couponCode, userId, venueId, subtotal: price.total });
      discount = { couponId: checked.coupon.id, amount: checked.discount };
    }

    const totalPrice = discount ? Math.round((price.total - discount.amount) * 100) / 100 : price.total;
    // Pay-online venues: the booking waits a few minutes for its payment and
    // is confirmed once paid (a free one - e.g. a 100% coupon - straight away).
    // Otherwise the owner has pendingHoldMinutes to confirm the request.
    const online = paysOnline(venue);
    const free = online && isFreeAmount(toPaise(totalPrice));

    return tx.booking.create({
      data: {
        userId,
        venueId,
        startTime,
        endTime,
        status: online ? (free ? "CONFIRMED" : "AWAITING_PAYMENT") : "PENDING",
        expiresAt: online ? (free ? null : paymentHoldUntil(startTime)) : holdUntil(venue, startTime),
        bookingCode: newBookingCode(),
        recurringGroupId: options.recurringGroupId ?? null,
        totalPrice,
        priceBreakdown: price.breakdown as unknown as Prisma.InputJsonValue,
        couponId: discount?.couponId ?? null,
        discountAmount: discount?.amount ?? null,
      },
      include: bookingPartiesInclude,
    });
  });

  runInBackground("expired notifications", () => announceExpiredBookings(releasedIds));

  // An unpaid booking stays between the customer and the gateway until paid
  // (payment.service announces it then).
  if (booking.status === "AWAITING_PAYMENT") return booking;

  emitBookingEvent("bookingCreated", booking, booking.venue.ownerId);

  // Separate tasks: one failing must not stop the others.
  runInBackground("waitlist booked", () => markWaitlistBooked(userId, venueId, startTime, endTime));
  if (booking.status === "CONFIRMED") {
    runInBackground("free booking notifications", async () => {
      await notifyBookingConfirmed(booking);
      await notifyOwnerPaidBooking(booking, 0);
    });
  } else if (options.notify !== false) {
    runInBackground("booking requested notifications", () => notifyBookingRequested(booking));
  }

  return booking;
};

/**
 * Creates the booking and, at a pay-online venue, its payment order. If the
 * gateway can't take the order, the booking is dropped at once so the time
 * isn't held for nobody.
 */
export const createBookingWithPayment = async (input: CreateBookingInput) => {
  const booking = await createBooking(input);
  if (booking.status !== "AWAITING_PAYMENT") return { booking, payment: null };

  try {
    return { booking, payment: await startPayment(booking.id, input.userId) };
  } catch (error) {
    await prisma.booking.updateMany({
      where: { id: booking.id, status: "AWAITING_PAYMENT" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: input.userId },
    });
    throw error;
  }
};

/**
 * Walk-in bookings and blocked time, entered by the venue owner. They are
 * confirmed immediately, don't need an opening slot and send no customer
 * notifications, but still can't overlap other bookings.
 */
export const createManualBooking = async (
  actor: { id: string; role: string },
  input: ManualBookingInput
) => {
  if (input.startTime >= input.endTime) {
    throw new ValidationError("Start time must be before end time");
  }

  const { booking, releasedIds } = await insertBookingLocked(
    input.venueId,
    input.startTime,
    input.endTime,
    async (tx, venue) => {
      if (actor.role !== "ADMIN" && venue.ownerId !== actor.id) {
        throw new ForbiddenError("You do not have permission to manage this venue");
      }

      const isBlock = input.kind === "BLOCK";
      const calculated = isBlock ? null : priceFor(venue, input.startTime, input.endTime);
      const total = isBlock ? 0 : (input.price ?? calculated!.total);
      const breakdown = isBlock
        ? []
        : input.price !== undefined
          ? [
              {
                label: "Price set by venue",
                ruleId: null,
                start: input.startTime.toISOString(),
                end: input.endTime.toISOString(),
                ratePerHour: null,
                amount: input.price,
              },
            ]
          : calculated!.breakdown;

      return tx.booking.create({
        data: {
          userId: actor.id,
          venueId: input.venueId,
          startTime: input.startTime,
          endTime: input.endTime,
          status: "CONFIRMED",
          source: input.kind,
          bookingCode: newBookingCode(),
          guestName: input.guestName ?? null,
          guestPhone: input.guestPhone ?? null,
          note: input.note ?? null,
          totalPrice: total,
          priceBreakdown: breakdown as unknown as Prisma.InputJsonValue,
        },
        include: bookingPartiesInclude,
      });
    }
  );

  emitBookingEvent("bookingCreated", booking, booking.venue.ownerId);
  runInBackground("expired notifications", () => announceExpiredBookings(releasedIds));

  return booking;
};

/**
 * "upcoming": still to be played, soonest first. "past": everything else,
 * latest first. "pending": requests waiting for the venue, most urgent first.
 * Omitted: all, newest request first.
 */
export type BookingScope = "upcoming" | "past" | "pending";

export const BOOKING_SCOPES: readonly BookingScope[] = ["upcoming", "past", "pending"];

const UPCOMING_STATUSES = ["PENDING", "AWAITING_PAYMENT", "CONFIRMED"] as const;

function scopeQuery(scope: BookingScope | undefined): {
  where: Prisma.BookingWhereInput;
  orderBy: Prisma.BookingOrderByWithRelationInput[];
} {
  const upcoming: Prisma.BookingWhereInput = { endTime: { gt: new Date() }, status: { in: [...UPCOMING_STATUSES] } };
  switch (scope) {
    case "upcoming":
      return { where: upcoming, orderBy: [{ startTime: "asc" }] };
    case "past":
      return { where: { NOT: upcoming }, orderBy: [{ startTime: "desc" }] };
    case "pending":
      return { where: { status: "PENDING" }, orderBy: [{ expiresAt: "asc" }, { startTime: "asc" }] };
    default:
      return { where: {}, orderBy: [{ createdAt: "desc" }] };
  }
}

export const getUserBookings = async (
  userId: string,
  pagination: PaginationParams,
  scope?: BookingScope
) => {
  const scoped = scopeQuery(scope);
  const where: Prisma.BookingWhereInput = { userId, ...scoped.where };
  const orderBy = scoped.orderBy;

  const [items, total] = await prisma.$transaction([
    prisma.booking.findMany({
      where,
      include: {
        venue: true,
        review: {
          select: {
            id: true,
            rating: true,
            review: true,
          },
        },
      },
      orderBy,
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.booking.count({ where }),
  ]);

  return { items, pagination: buildPaginationMeta(pagination, total) };
};

export const getProviderBookings = async (
  providerId: string,
  pagination: PaginationParams,
  scope?: BookingScope
) => {
  const scoped = scopeQuery(scope);
  const where: Prisma.BookingWhereInput = { venue: { ownerId: providerId }, ...scoped.where };

  const [items, total] = await prisma.$transaction([
    prisma.booking.findMany({
      where,
      include: {
        venue: true,
        user: {
          select: bookingUserSelect,
        },
      },
      orderBy: scoped.orderBy,
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.booking.count({ where }),
  ]);

  return { items, pagination: buildPaginationMeta(pagination, total) };
};

export const getBookingById = async (
  bookingId: string,
  userId: string
) => {
  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      userId,
    },
    include: {
      venue: true,
    },
  });

  if (!booking) {
    throw new NotFoundError("Booking not found");
  }

  return booking;
};

const findBookingForManagement = async (bookingId: string) => {
  const booking = await prisma.booking.findUnique({
    where: {
      id: bookingId,
    },
    include: bookingPartiesInclude,
  });

  if (!booking) {
    throw new NotFoundError("Booking not found");
  }

  return booking;
};

/** Who may cancel: the customer, the venue owner, or an admin. */
function assertCanCancel(
  booking: Awaited<ReturnType<typeof findBookingForManagement>>,
  userId: string,
  userRole: string
) {
  const canCancel =
    userRole === "ADMIN" ||
    (userRole === "USER" && booking.userId === userId) ||
    (userRole === "PROVIDER" && booking.venue.ownerId === userId);

  if (!canCancel) {
    throw new ForbiddenError("You do not have permission to cancel this booking");
  }

  if (booking.status === "CANCELLED") {
    throw new ConflictError("Booking is already cancelled");
  }

  if (booking.status === "COMPLETED") {
    throw new ConflictError("Completed booking cannot be cancelled");
  }

  if (booking.status === "EXPIRED") {
    throw new ConflictError("This booking request has already expired");
  }
}

const refundFor = (
  booking: Awaited<ReturnType<typeof findBookingForManagement>> & {
    totalPrice: unknown;
    source: string;
    venue: { cancellationPolicy?: unknown };
  },
  userId: string,
  userRole: string
) =>
  quoteRefund({
    policy: booking.venue.cancellationPolicy,
    startTime: booking.startTime,
    // Nothing was paid yet for a booking still waiting for its payment.
    totalPrice: booking.status === "AWAITING_PAYMENT" ? 0 : Number(booking.totalPrice ?? 0),
    status: booking.status,
    cancelledByVenue:
      userRole === "ADMIN" || booking.venue.ownerId === userId || booking.source !== "ONLINE",
  });

const findForCancellation = (bookingId: string) =>
  prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      ...bookingPartiesInclude,
      venue: { select: { ...bookingPartiesInclude.venue.select, cancellationPolicy: true } },
    },
  });

/** What cancelling now would refund, shown before the customer confirms. */
export const getCancellationQuote = async (bookingId: string, userId: string, userRole: string) => {
  const booking = await findForCancellation(bookingId);

  if (!booking) {
    throw new NotFoundError("Booking not found");
  }

  assertCanCancel(booking, userId, userRole);
  return refundFor(booking, userId, userRole);
};

export const cancelBooking = async (
  bookingId: string,
  userId: string,
  userRole: string
) => {
  const booking = await findForCancellation(bookingId);

  if (!booking) {
    throw new NotFoundError("Booking not found");
  }

  assertCanCancel(booking, userId, userRole);
  const refund = refundFor(booking, userId, userRole);
  const unpaid = booking.status === "AWAITING_PAYMENT";

  // The booking and the money going back change together; the refund itself
  // is sent to the gateway by a retried job once this commits.
  const { updatedBooking, refundIds } = await prisma.$transaction(async (tx) => {
    const { count } = await tx.booking.updateMany({
      where: { id: bookingId, status: booking.status },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: userId,
        refundPercent: unpaid ? null : refund.refundPercent,
        refundAmount: unpaid ? null : refund.refundAmount,
      },
    });
    if (count === 0) throw new ConflictError("This booking changed in the meantime; refresh and try again");

    const paid = await paidPaise(tx, bookingId);
    const refundIds = await refundForCancellation(
      tx,
      bookingId,
      Math.round((paid * refund.refundPercent) / 100),
      refund.reason
    );
    return { updatedBooking: await tx.booking.findUniqueOrThrow({ where: { id: bookingId } }), refundIds };
  });

  for (const refundId of refundIds) await enqueueRefund(refundId);

  emitBookingEvent("bookingCancelled", updatedBooking, booking.venue.ownerId);

  if (userRole === "ADMIN") {
    await recordAudit({
      action: "booking.cancelled",
      entityType: "Booking",
      entityId: bookingId,
      before: { status: booking.status },
      after: { status: "CANCELLED", refundPercent: refund.refundPercent, refundAmount: refund.refundAmount },
    });
  }

  // Someone on the waitlist may want this time.
  runInBackground("waitlist", () => processWaitlist(booking.venueId, booking.startTime, booking.endTime));

  // Walk-ins and blocked time have no customer account to notify.
  if (booking.source === "ONLINE") {
    runInBackground("booking cancelled notifications", () =>
      notifyBookingCancelled(booking, userId)
    );
  }

  return updatedBooking;
};

export const confirmBooking = async (
  bookingId: string,
  userId: string,
  userRole: string
) => {
  const booking = await findBookingForManagement(bookingId);

  if (
    userRole !== "ADMIN" &&
    booking.venue.ownerId !== userId
  ) {
    throw new ForbiddenError(
      "You do not have permission to manage this booking"
    );
  }

  if (booking.status === "AWAITING_PAYMENT") {
    throw new ConflictError("This booking is waiting for the customer's payment; it's confirmed once paid");
  }

  if (booking.status !== "PENDING") {
    throw new ConflictError(
      `Only pending bookings can be confirmed (current status: ${booking.status})`
    );
  }

  // Confirm only while the request is still within its hold; the expiry job
  // may be flipping it at this very moment.
  const now = new Date();
  const { count } = await prisma.booking.updateMany({
    where: {
      id: bookingId,
      status: "PENDING",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    data: { status: "CONFIRMED" },
  });

  if (count === 0) {
    const expired = await prisma.booking.updateMany({
      where: { id: bookingId, status: "PENDING", expiresAt: { lte: now } },
      data: { status: "EXPIRED" },
    });

    if (expired.count > 0) {
      runInBackground("booking expired notifications", () =>
        announceExpiredBookings([bookingId])
      );
    }

    throw new ConflictError("This booking request has expired and can no longer be confirmed");
  }

  const updatedBooking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
  });

  emitBookingEvent("bookingConfirmed", updatedBooking, booking.venue.ownerId);

  if (userRole === "ADMIN") {
    await recordAudit({
      action: "booking.confirmed",
      entityType: "Booking",
      entityId: bookingId,
      before: { status: "PENDING" },
      after: { status: "CONFIRMED" },
    });
  }

  runInBackground("booking confirmed notifications", () =>
    notifyBookingConfirmed(booking)
  );

  return updatedBooking;
};

export const completeBooking = async (
  bookingId: string,
  userId: string,
  userRole: string
) => {
  const booking = await findBookingForManagement(bookingId);

  if (
    userRole !== "ADMIN" &&
    booking.venue.ownerId !== userId
  ) {
    throw new ForbiddenError(
      "You do not have permission to manage this booking"
    );
  }

  if (booking.status !== "CONFIRMED") {
    throw new ConflictError(
      "Only confirmed bookings can be completed"
    );
  }

  const updatedBooking = await prisma.booking.update({
    where: {
      id: bookingId,
    },
    data: {
      status: "COMPLETED",
    },
  });

  emitBookingEvent("bookingCompleted", updatedBooking, booking.venue.ownerId);

  if (userRole === "ADMIN") {
    await recordAudit({
      action: "booking.completed",
      entityType: "Booking",
      entityId: bookingId,
      before: { status: "CONFIRMED" },
      after: { status: "COMPLETED" },
    });
  }

  if (booking.source === "ONLINE") runInBackground("booking completed notifications", () =>
    notifyBookingCompleted(booking)
  );

  return updatedBooking;
};
