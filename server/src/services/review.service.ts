import prisma from "../config/prisma.js";
import type { Prisma, ReviewStatus } from "../generated/prisma/client.js";
import { isUniqueViolation } from "../utils/dbErrors.js";
import { buildPaginationMeta, type PaginationParams } from "../utils/pagination.js";
import { recordAudit } from "./audit.service.js";
import { venueChanged } from "./venueCache.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors.js";

interface CreateReviewInput {
  userId: string;
  bookingId: string;
  rating: number;
  review?: string;
}

export const createReview = async ({
  userId,
  bookingId,
  rating,
  review,
}: CreateReviewInput) => {
  if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    throw new ValidationError("Rating must be an integer between 1 and 5");
  }

  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      userId,
    },
  });

  if (!booking) {
    throw new NotFoundError("Booking not found");
  }

  if (booking.status !== "COMPLETED") {
    throw new ConflictError("You can review only after the booking is completed");
  }

  const existingReview = await prisma.review.findUnique({
    where: {
      bookingId,
    },
  });

  if (existingReview) {
    throw new ConflictError("This booking has already been reviewed");
  }

  const created = await prisma.review
    .create({
      data: {
        userId,
        venueId: booking.venueId,
        bookingId,
        rating,
        review: review ?? null,
      },
      include: {
        venue: true,
        booking: true,
      },
    })
    .catch((error: unknown) => {
      // Two concurrent submissions for the same booking
      if (isUniqueViolation(error)) {
        throw new ConflictError("This booking has already been reviewed");
      }

      throw error;
    });

  await refreshVenueRating(booking.venueId);

  return created;
};

/**
 * Recomputes the stored average from all reviews in one statement, so
 * concurrent reviews can't leave it stale.
 */
export async function refreshVenueRating(venueId: string, client: Pick<typeof prisma, "$executeRaw"> = prisma) {
  // Hidden reviews don't count.
  await client.$executeRaw`
    UPDATE "Venue" SET
      "avgRating" = COALESCE((SELECT ROUND(AVG("rating")::numeric, 2)::float8 FROM "Review" WHERE "venueId" = ${venueId} AND "status" <> 'HIDDEN'), 0),
      "reviewCount" = (SELECT count(*)::int FROM "Review" WHERE "venueId" = ${venueId} AND "status" <> 'HIDDEN')
    WHERE id = ${venueId}
  `;
  venueChanged(venueId);
}

export const getVenueRating = async (venueId: string) => {
  const reviews = await prisma.review.findMany({
    where: {
      venueId,
      status: { not: "HIDDEN" },
    },
    select: {
      rating: true,
    },
  });

  if (reviews.length === 0) {
    return {
      averageRating: 0,
      totalReviews: 0,
    };
  }

  const totalRating = reviews.reduce(
    (sum, review) => sum + review.rating,
    0
  );

  const averageRating = totalRating / reviews.length;

  return {
    averageRating: Number(averageRating.toFixed(2)),
    totalReviews: reviews.length,
  };
};

/** The venue owner (or an admin) replies publicly to a review; null removes the reply. */
export async function replyToReview(
  reviewId: string,
  actor: { id: string; role: string },
  reply: string | null
) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    include: { venue: { select: { ownerId: true } } },
  });

  if (!review) {
    throw new NotFoundError("Review not found");
  }

  if (actor.role !== "ADMIN" && review.venue.ownerId !== actor.id) {
    throw new ForbiddenError("Only the venue owner can reply to this review");
  }

  return prisma.review.update({
    where: { id: reviewId },
    data: { providerReply: reply, providerRepliedAt: reply ? new Date() : null },
    select: { id: true, providerReply: true, providerRepliedAt: true },
  });
}

/** Reviews of the provider's venues, newest first; `unanswered` hides replied ones. */
export async function listProviderReviews(
  ownerId: string,
  pagination: { skip: number; limit: number; page: number },
  filters: { venueId?: string | undefined; unanswered?: boolean | undefined } = {}
) {
  const where = {
    venue: { ownerId },
    ...(filters.venueId && { venueId: filters.venueId }),
    ...(filters.unanswered && { providerReply: null }),
  };

  const [reviews, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.limit,
      select: {
        id: true,
        rating: true,
        review: true,
        createdAt: true,
        providerReply: true,
        providerRepliedAt: true,
        status: true,
        user: { select: { name: true } },
        venue: { select: { id: true, name: true } },
      },
    }),
    prisma.review.count({ where }),
  ]);

  return {
    reviews,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
    },
  };
}

// ---------------------------------------------------------------------------
// Reports and moderation
// ---------------------------------------------------------------------------

/**
 * Anyone signed in may report a review once (not their own). The first
 * report puts a visible review in the admins' flagged queue; it stays on the
 * venue page until an admin hides it.
 */
export async function reportReview(reviewId: string, reporterId: string, reason: string) {
  const review = await prisma.review.findUnique({ where: { id: reviewId }, select: { userId: true, status: true } });

  if (!review || review.status === "HIDDEN") {
    throw new NotFoundError("Review not found");
  }

  if (review.userId === reporterId) {
    throw new ValidationError("You can't report your own review");
  }

  try {
    await prisma.$transaction([
      prisma.reviewReport.create({ data: { reviewId, reporterId, reason } }),
      prisma.review.updateMany({ where: { id: reviewId, status: "VISIBLE" }, data: { status: "FLAGGED" } }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("You have already reported this review");
    }
    throw error;
  }
}

const moderationSelect = {
  id: true,
  rating: true,
  review: true,
  status: true,
  moderationNote: true,
  moderatedAt: true,
  createdAt: true,
  providerReply: true,
  user: { select: { id: true, name: true, email: true } },
  venue: { select: { id: true, name: true } },
  reports: {
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      reason: true,
      createdAt: true,
      resolvedAt: true,
      reporter: { select: { id: true, name: true, email: true } },
    },
  },
} satisfies Prisma.ReviewSelect;

/** Admin queue: FLAGGED first-reported first; other statuses newest first. */
export async function listReviewsForModeration(
  pagination: PaginationParams,
  filters: { status?: ReviewStatus | undefined; venueId?: string | undefined } = {}
) {
  const where: Prisma.ReviewWhereInput = {
    ...(filters.status && { status: filters.status }),
    ...(filters.venueId && { venueId: filters.venueId }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.review.findMany({
      where,
      orderBy: filters.status === "FLAGGED" ? { updatedAt: "asc" } : { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.limit,
      select: moderationSelect,
    }),
    prisma.review.count({ where }),
  ]);

  return { items, pagination: buildPaginationMeta(pagination, total) };
}

/** HIDDEN removes it from the venue page and rating; VISIBLE restores it. Open reports are closed either way. */
export async function moderateReview(reviewId: string, status: "HIDDEN" | "VISIBLE", note: string | null) {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });

  if (!review) {
    throw new NotFoundError("Review not found");
  }

  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    await tx.reviewReport.updateMany({ where: { reviewId, resolvedAt: null }, data: { resolvedAt: now } });
    const result = await tx.review.update({
      where: { id: reviewId },
      data: { status, moderationNote: note, moderatedAt: now },
      select: moderationSelect,
    });
    await refreshVenueRating(review.venueId, tx);
    await recordAudit(
      {
        action: status === "HIDDEN" ? "review.hidden" : "review.restored",
        entityType: "Review",
        entityId: reviewId,
        before: { status: review.status, moderationNote: review.moderationNote },
        after: { status, moderationNote: note },
        reason: note,
      },
      tx
    );

    return result;
  });

  return updated;
}
