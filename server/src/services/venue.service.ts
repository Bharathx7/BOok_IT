import prisma from "../config/prisma.js";
import { Prisma, type Venue } from "../generated/prisma/client.js";
import { removeQuietly } from "../storage/index.js";
import { DEFAULT_TIMEZONE } from "../utils/datetime.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../utils/errors.js";
import {
  buildPaginationMeta,
  type PaginationParams,
} from "../utils/pagination.js";
import { searchVenueIds, type VenueSearchParams } from "./venueSearch.service.js";
import { changedFields, recordAudit } from "./audit.service.js";
import { getSettings } from "./settings.service.js";
import { findPublicVenue, publicVenueWhere } from "./venueVisibility.js";
import { cached } from "../utils/cache.js";
import { POPULAR_TTL_MS, VENUE_TTL_MS, popularKey, venueChanged, venueKey } from "./venueCache.js";

export type OpeningHours = Record<string, { open: string; close: string } | null>;

export interface VenueInput {
  name: string;
  description?: string | undefined;
  category?: string | undefined;
  address?: string | undefined;
  city?: string | undefined;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  sportTypes?: string[] | undefined;
  amenities?: string[] | undefined;
  rules?: string | null | undefined;
  openingHours?: OpeningHours | null | undefined;
  isActive?: boolean | undefined;
  paymentMode?: "PAY_AT_VENUE" | "PAY_ONLINE" | undefined;
  pricePerHour?: number | undefined;
  timezone?: string | undefined;
  pendingHoldMinutes?: number | undefined;
  slotMinutes?: number | undefined;
  maxBookingMinutes?: number | undefined;
  cancellationPolicy?: { hoursBefore: number; refundPercent: number }[] | null | undefined;
}

const imagesInclude = {
  orderBy: [{ position: "asc" }, { createdAt: "asc" }],
} satisfies Prisma.Venue$imagesArgs;

type VenueWithImages = Venue & {
  images: { id: string; url: string; isCover: boolean; width: number | null; height: number | null }[];
};

/** Card-sized view used by search results, favourites and dashboards. */
const toVenueSummary = (
  venue: VenueWithImages,
  extra: { distanceKm?: number | null; isFavorite?: boolean } = {}
) => {
  const cover = venue.images.find((image) => image.isCover) ?? venue.images[0] ?? null;
  const { images: _images, ...fields } = venue;

  return {
    ...fields,
    coverImageUrl: cover?.url ?? null,
    imageCount: venue.images.length,
    distanceKm:
      extra.distanceKm === undefined || extra.distanceKm === null
        ? null
        : Math.round(extra.distanceKm * 10) / 10,
    isFavorite: extra.isFavorite ?? false,
  };
};

async function favoriteIdsFor(userId: string | undefined, venueIds: string[]) {
  if (!userId || venueIds.length === 0) return new Set<string>();

  const favorites = await prisma.favorite.findMany({
    where: { userId, venueId: { in: venueIds } },
    select: { venueId: true },
  });

  return new Set(favorites.map((favorite) => favorite.venueId));
}

// ---------------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------------

/** Only the fields that were sent; `null` clears optional ones. */
const toVenueData = (data: Partial<VenueInput>) => {
  const { openingHours, cancellationPolicy, ...rest } = data;
  const fields = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined)
  ) as Prisma.VenueUncheckedUpdateInput;

  if (openingHours !== undefined) {
    fields.openingHours = openingHours === null ? Prisma.DbNull : openingHours;
  }

  if (cancellationPolicy !== undefined) {
    fields.cancellationPolicy =
      cancellationPolicy === null
        ? Prisma.DbNull
        : [...cancellationPolicy].sort((a, b) => b.hoursBefore - a.hoursBefore);
  }

  return fields;
};

/** The main sport always counts as one of the venue's sports. */
function mergeSports(category: string | undefined, sportTypes: string[] | undefined) {
  const sports = new Set(sportTypes ?? []);
  if (category && category !== "Other") sports.add(category);
  return [...sports];
}

/** Providers' new listings wait for an admin (if the platform requires it); admins' go live. */
export const createVenue = async (data: VenueInput, owner: { id: string; role: string }) => {
  const settings = await getSettings();
  const needsApproval = owner.role !== "ADMIN" && settings.requireVenueApproval;

  return prisma.venue.create({
    data: {
      category: "Other",
      timezone: DEFAULT_TIMEZONE,
      pricePerHour: 0,
      pendingHoldMinutes: settings.defaultPendingHoldMinutes,
      ...(toVenueData(data) as Omit<Prisma.VenueUncheckedCreateInput, "ownerId">),
      sportTypes: mergeSports(data.category, data.sportTypes),
      approvalStatus: needsApproval ? "PENDING" : "APPROVED",
      ownerId: owner.id,
    },
  });
};

const findOwnedVenue = async (id: string, userId: string, isAdmin: boolean) => {
  const venue = await prisma.venue.findUnique({ where: { id } });

  if (!venue) {
    throw new NotFoundError("Venue not found");
  }

  if (!isAdmin && venue.ownerId !== userId) {
    throw new ForbiddenError("You do not have permission to manage this venue");
  }

  return venue;
};

export const updateVenue = async (
  id: string,
  userId: string,
  isAdmin: boolean,
  data: Partial<VenueInput>
) => {
  const venue = await findOwnedVenue(id, userId, isAdmin);
  const changes = toVenueData(data);

  if (data.category !== undefined || data.sportTypes !== undefined) {
    changes.sportTypes = mergeSports(
      data.category ?? venue.category,
      data.sportTypes ?? venue.sportTypes
    );
  }

  // Editing a rejected listing sends it back to the review queue.
  if (venue.approvalStatus === "REJECTED" && !isAdmin) {
    changes.approvalStatus = "PENDING";
  }

  const updated = await prisma.venue.update({
    where: { id },
    data: changes,
  });
  venueChanged(id);

  if (isAdmin && venue.ownerId !== userId) {
    await recordAudit({ action: "venue.updated", entityType: "Venue", entityId: id, ...changedFields(venue, updated) });
  }

  return updated;
};

export const deleteVenue = async (id: string, userId: string, isAdmin: boolean) => {
  const venue = await findOwnedVenue(id, userId, isAdmin);

  const images = await prisma.venueImage.findMany({
    where: { venueId: id },
    select: { storageKey: true },
  });

  try {
    const deleted = await prisma.venue.delete({ where: { id } });
    venueChanged(id);
    await removeQuietly(images.map((image) => image.storageKey));
    await recordAudit({ action: "venue.deleted", entityType: "Venue", entityId: id, before: venue });
    return deleted;
  } catch (error) {
    // Bookings, slots and reviews reference the venue.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2003" || error.code === "P2014")
    ) {
      throw new ConflictError(
        "Venue has bookings, time slots or reviews and cannot be deleted. Hide it instead."
      );
    }

    throw error;
  }
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function searchVenues(
  params: VenueSearchParams,
  pagination: PaginationParams,
  viewerId?: string
) {
  const { rows, pagination: meta } = await searchVenueIds(params, pagination);
  const ids = rows.map((row) => row.id);

  const [venues, favorites] = await Promise.all([
    prisma.venue.findMany({ where: { id: { in: ids } }, include: { images: imagesInclude } }),
    favoriteIdsFor(viewerId, ids),
  ]);

  const byId = new Map(venues.map((venue) => [venue.id, venue]));

  const items = rows.flatMap((row) => {
    const venue = byId.get(row.id);
    return venue
      ? [toVenueSummary(venue, { distanceKm: row.distance_km, isFavorite: favorites.has(row.id) })]
      : [];
  });

  return { items, pagination: meta };
}

/** Cached for everyone; only the favourite hearts are per viewer. */
export const getPopularVenues = async (limit: number, viewerId?: string) => {
  const items = await cached(popularKey(limit), POPULAR_TTL_MS, async () =>
    (await searchVenues({ sort: "popular" }, { page: 1, limit, skip: 0 })).items
  );
  const favorites = await favoriteIdsFor(viewerId, items.map((venue) => venue.id));
  return items.map((venue) => ({ ...venue, isFavorite: favorites.has(venue.id) }));
};

/** The provider's own venues, including hidden ones. */
export const getMyVenues = async (ownerId: string, pagination: PaginationParams) => {
  const where = { ownerId } satisfies Prisma.VenueWhereInput;

  const [venues, total] = await prisma.$transaction([
    prisma.venue.findMany({
      where,
      include: { images: imagesInclude },
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.venue.count({ where }),
  ]);

  return {
    items: venues.map((venue) => toVenueSummary(venue)),
    pagination: buildPaginationMeta(pagination, total),
  };
};

/** Full venue page. Hidden venues are only visible to their owner and admins. */
export const getVenueById = async (
  id: string,
  viewer?: { id: string; role: string }
) => {
  // The row is shared by all viewers; who may see it is decided below.
  const venue = await cached(venueKey(id), VENUE_TTL_MS, () =>
    prisma.venue.findUnique({
      where: { id },
      include: {
        images: imagesInclude,
        owner: { select: { id: true, name: true, status: true } },
      },
    })
  );

  const canSeeHidden =
    viewer !== undefined && (viewer.role === "ADMIN" || viewer.id === venue?.ownerId);
  const isPublic =
    venue?.isActive === true && venue.approvalStatus === "APPROVED" && venue.owner.status === "ACTIVE";

  if (!venue || (!isPublic && !canSeeHidden)) {
    throw new NotFoundError("Venue not found");
  }

  const isFavorite = viewer
    ? (await prisma.favorite.count({ where: { userId: viewer.id, venueId: id } })) > 0
    : false;

  const { owner, ...rest } = venue;

  return {
    ...toVenueSummary(rest, { isFavorite }),
    images: venue.images,
    owner: { id: owner.id, name: owner.name },
  };
};

export async function getVenueReviews(venueId: string, pagination: PaginationParams) {
  const where = { venueId, status: { not: "HIDDEN" } } satisfies Prisma.ReviewWhereInput;

  const [reviews, total] = await prisma.$transaction([
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
        user: { select: { name: true } },
      },
    }),
    prisma.review.count({ where }),
  ]);

  return { reviews, pagination: buildPaginationMeta(pagination, total) };
}

// ---------------------------------------------------------------------------
// Favourites
// ---------------------------------------------------------------------------

export async function addFavorite(userId: string, venueId: string) {
  await findPublicVenue(venueId);

  await prisma.favorite.upsert({
    where: { userId_venueId: { userId, venueId } },
    update: {},
    create: { userId, venueId },
  });
}

export async function removeFavorite(userId: string, venueId: string) {
  await prisma.favorite.deleteMany({ where: { userId, venueId } });
}

export async function getFavoriteVenues(userId: string, pagination: PaginationParams) {
  const where = { userId, venue: publicVenueWhere } satisfies Prisma.FavoriteWhereInput;

  const [favorites, total] = await prisma.$transaction([
    prisma.favorite.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.limit,
      include: { venue: { include: { images: imagesInclude } } },
    }),
    prisma.favorite.count({ where }),
  ]);

  return {
    items: favorites.map((favorite) => toVenueSummary(favorite.venue, { isFavorite: true })),
    pagination: buildPaginationMeta(pagination, total),
  };
}
