import { invalidate } from "../utils/cache.js";

// Keys and invalidation for cached venue reads (see utils/cache.ts).

export const VENUE_TTL_MS = 5 * 60 * 1000;
export const POPULAR_TTL_MS = 60 * 1000;

export const venueKey = (venueId: string) => `venue:${venueId}`;
export const popularKey = (limit: number) => `venues:popular:${limit}`;

/**
 * Call after anything a venue page shows changes: details, photos, rating,
 * approval, or its owner's account status. Without an id, drops every venue.
 */
export function venueChanged(venueId?: string) {
  invalidate(venueId ? venueKey(venueId) : "venue:");
  invalidate("venues:");
}
