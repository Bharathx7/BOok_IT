import prisma from "../config/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { buildPaginationMeta, type PaginationParams } from "../utils/pagination.js";
import { PUBLIC_VENUE_SQL } from "./venueVisibility.js";
import { holdsTimeSql } from "./bookingHolds.js";

// Venue search runs as one SQL query so that filtering, sorting and paging
// happen in Postgres. Full venue rows are then loaded with Prisma.

export type VenueSort =
  | "recommended"
  | "relevance"
  | "price_asc"
  | "price_desc"
  | "rating"
  | "distance"
  | "popular"
  | "newest";

export interface VenueSearchParams {
  q?: string | undefined;
  sport?: string | undefined;
  city?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  minRating?: number | undefined;
  amenities?: string[] | undefined;
  /** YYYY-MM-DD, in each venue's own timezone. */
  date?: string | undefined;
  /** HH:mm; with `date`, the venue must be free for `duration` minutes from then. */
  time?: string | undefined;
  duration?: number | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
  radiusKm?: number | undefined;
  sort?: VenueSort | undefined;
}

// Must match the "Venue_search_idx" expression index (migration phase3_discovery).
const SEARCH_DOCUMENT = Prisma.raw(
  `to_tsvector('simple'::regconfig, coalesce(v."name", '') || ' ' || coalesce(v."description", '') || ' ' || coalesce(v."address", '') || ' ' || coalesce(v."city", ''))`
);

// Timestamps are stored as UTC "timestamp without time zone".
const NOW_UTC = Prisma.raw(`(now() AT TIME ZONE 'UTC')`);

// Bookings that hold time: confirmed, or waiting and not yet past their hold.
const HOLDS_TIME = holdsTimeSql("b", NOW_UTC);

const POPULARITY = Prisma.sql`(
  SELECT count(*) FROM "Booking" pb
  WHERE pb."venueId" = v.id
    AND pb."status" IN ('PENDING', 'CONFIRMED', 'COMPLETED')
    AND pb."createdAt" > ${NOW_UTC} - interval '30 days'
)`;

const MIN_FREE = Prisma.raw(`interval '30 minutes'`);

/** "5-a-side turf" -> "5:* & a:* & side:* & turf:*" (every word, as a prefix). */
export function toPrefixQuery(text: string) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.slice(0, 8).map((word) => `${word}:*`).join(" & ");
}

const haversineKm = (lat: number, lng: number) => Prisma.sql`(
  6371 * 2 * asin(sqrt(
    power(sin(radians(v."latitude" - ${lat}) / 2), 2) +
    cos(radians(${lat})) * cos(radians(v."latitude")) *
    power(sin(radians(v."longitude" - ${lng}) / 2), 2)
  ))
)`;

/** Local wall-clock time in the venue's timezone -> stored UTC timestamp. */
const venueLocalToUtc = (localTimestamp: Prisma.Sql) =>
  Prisma.sql`((${localTimestamp}) AT TIME ZONE v."timezone") AT TIME ZONE 'UTC'`;

function availabilityCondition(date: string, time: string | undefined, duration: number) {
  if (time) {
    // A slot covers the whole requested time and nothing holds any of it.
    const start = venueLocalToUtc(Prisma.sql`${date}::date + ${time}::time`);
    const end = Prisma.sql`(${start} + ${duration} * interval '1 minute')`;

    return Prisma.sql`(
      ${start} > ${NOW_UTC}
      AND EXISTS (
        SELECT 1 FROM "TimeSlot" ts
        WHERE ts."venueId" = v.id AND ts."startTime" <= ${start} AND ts."endTime" >= ${end}
      )
      AND NOT EXISTS (
        SELECT 1 FROM "Booking" b
        WHERE b."venueId" = v.id AND ${HOLDS_TIME}
          AND b."startTime" < ${end} AND b."endTime" > ${start}
      )
      AND NOT EXISTS (
        SELECT 1 FROM "BlackoutDate" bo
        WHERE bo."venueId" = v.id AND bo."startTime" < ${end} AND bo."endTime" > ${start}
      )
    )`;
  }

  // Whole day: some slot that day still has at least 30 free minutes left.
  // Busy time is active bookings plus closures. Bookings never overlap each
  // other; a closure overlapping a booking is counted twice, which only makes
  // the check stricter.
  const dayStart = Prisma.sql`GREATEST(${venueLocalToUtc(Prisma.sql`${date}::date::timestamp`)}, ${NOW_UTC})`;
  const dayEnd = venueLocalToUtc(Prisma.sql`(${date}::date + 1)::timestamp`);
  const windowStart = Prisma.sql`GREATEST(ts."startTime", ${dayStart})`;
  const windowEnd = Prisma.sql`LEAST(ts."endTime", ${dayEnd})`;

  return Prisma.sql`EXISTS (
    SELECT 1 FROM "TimeSlot" ts
    WHERE ts."venueId" = v.id
      AND ts."startTime" < ${dayEnd} AND ts."endTime" > ${dayStart}
      AND (${windowEnd} - ${windowStart}) - COALESCE((
        SELECT sum(LEAST(busy."endTime", ${windowEnd}) - GREATEST(busy."startTime", ${windowStart}))
        FROM (
          SELECT b."startTime", b."endTime" FROM "Booking" b
          WHERE b."venueId" = v.id AND ${HOLDS_TIME}
          UNION ALL
          SELECT bo."startTime", bo."endTime" FROM "BlackoutDate" bo
          WHERE bo."venueId" = v.id
        ) busy
        WHERE busy."startTime" < ${windowEnd} AND busy."endTime" > ${windowStart}
      ), interval '0') >= ${MIN_FREE}
  )`;
}

interface SearchRow {
  id: string;
  distance_km: number | null;
}

export async function searchVenueIds(params: VenueSearchParams, pagination: PaginationParams) {
  const conditions: Prisma.Sql[] = [PUBLIC_VENUE_SQL];

  const query = params.q ? toPrefixQuery(params.q) : "";
  if (query) {
    conditions.push(Prisma.sql`${SEARCH_DOCUMENT} @@ to_tsquery('simple', ${query})`);
  }

  if (params.sport) {
    conditions.push(Prisma.sql`(
      lower(v."category") = lower(${params.sport})
      OR EXISTS (SELECT 1 FROM unnest(v."sportTypes") s WHERE lower(s) = lower(${params.sport}))
    )`);
  }

  if (params.city) {
    conditions.push(Prisma.sql`lower(v."city") = lower(${params.city.trim()})`);
  }

  if (params.minPrice !== undefined) {
    conditions.push(Prisma.sql`v."pricePerHour" >= ${params.minPrice}`);
  }

  if (params.maxPrice !== undefined) {
    conditions.push(Prisma.sql`v."pricePerHour" <= ${params.maxPrice}`);
  }

  if (params.minRating !== undefined) {
    conditions.push(Prisma.sql`v."avgRating" >= ${params.minRating}`);
  }

  if (params.amenities?.length) {
    conditions.push(Prisma.sql`v."amenities" @> ${params.amenities}::text[]`);
  }

  if (params.date) {
    conditions.push(availabilityCondition(params.date, params.time, params.duration ?? 60));
  }

  const hasLocation = params.lat !== undefined && params.lng !== undefined;
  const distance = hasLocation ? haversineKm(params.lat!, params.lng!) : Prisma.sql`NULL::float8`;

  if (hasLocation) {
    const radius = params.radiusKm ?? 10;
    // Cheap bounding box first, exact distance second.
    const latDelta = radius / 111;
    const lngDelta = radius / (111 * Math.max(Math.cos((params.lat! * Math.PI) / 180), 0.01));

    conditions.push(Prisma.sql`v."latitude" BETWEEN ${params.lat! - latDelta} AND ${params.lat! + latDelta}`);
    conditions.push(Prisma.sql`v."longitude" BETWEEN ${params.lng! - lngDelta} AND ${params.lng! + lngDelta}`);
    conditions.push(Prisma.sql`${distance} <= ${radius}`);
  }

  const where = Prisma.join(conditions, " AND ");

  const sort: VenueSort =
    params.sort ?? (query ? "relevance" : hasLocation ? "distance" : "recommended");

  const orderBy = (() => {
    switch (sort) {
      case "relevance":
        return query
          ? Prisma.sql`ts_rank(${SEARCH_DOCUMENT}, to_tsquery('simple', ${query})) DESC, v."avgRating" DESC`
          : Prisma.sql`v."avgRating" DESC`;
      case "price_asc":
        return Prisma.sql`v."pricePerHour" ASC`;
      case "price_desc":
        return Prisma.sql`v."pricePerHour" DESC`;
      case "rating":
        return Prisma.sql`v."avgRating" DESC, v."reviewCount" DESC`;
      case "distance":
        return hasLocation ? Prisma.sql`${distance} ASC` : Prisma.sql`v."avgRating" DESC`;
      case "popular":
        return Prisma.sql`${POPULARITY} DESC, v."avgRating" DESC`;
      case "newest":
        return Prisma.sql`v."createdAt" DESC`;
      default:
        return Prisma.sql`v."avgRating" DESC, v."reviewCount" DESC, ${POPULARITY} DESC`;
    }
  })();

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<SearchRow[]>`
      SELECT v.id, ${distance} AS distance_km
      FROM "Venue" v
      WHERE ${where}
      ORDER BY ${orderBy}, v."createdAt" DESC, v.id
      LIMIT ${pagination.limit} OFFSET ${pagination.skip}
    `,
    prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM "Venue" v WHERE ${where}`,
  ]);

  return {
    rows,
    pagination: buildPaginationMeta(pagination, Number(countRows[0]?.total ?? 0)),
  };
}
