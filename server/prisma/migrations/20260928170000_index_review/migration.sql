-- Index review (Phase 7), measured with scripts/explain-hot-queries.ts on seeded data.

-- Provider booking lists (newest first across a provider's venues) and the
-- 30-day popularity count used to rank search results.
CREATE INDEX "Booking_venueId_createdAt_idx" ON "Booking"("venueId", "createdAt");

-- A venue's reviews, newest first. Replaces the single-column index.
DROP INDEX "Review_venueId_idx";
CREATE INDEX "Review_venueId_createdAt_idx" ON "Review"("venueId", "createdAt");
