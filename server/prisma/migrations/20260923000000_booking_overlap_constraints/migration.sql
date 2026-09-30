-- Venue timezone (all timestamps stay stored in UTC)
ALTER TABLE "Venue" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- Speeds up "my bookings" listing
CREATE INDEX "Booking_userId_createdAt_idx" ON "Booking"("userId", "createdAt");

-- btree_gist lets a GiST exclusion constraint combine equality on text
-- columns with range overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Database-level guarantee against double booking: two active bookings for
-- the same venue can never overlap, even when requests race each other.
-- Half-open ranges '[)' allow back-to-back bookings (10-11 and 11-12).
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap"
  EXCLUDE USING gist (
    "venueId" WITH =,
    tsrange("startTime", "endTime", '[)') WITH &&
  )
  WHERE ("status" IN ('PENDING', 'CONFIRMED'));

-- Same guarantee for provider availability slots.
ALTER TABLE "TimeSlot"
  ADD CONSTRAINT "TimeSlot_no_overlap"
  EXCLUDE USING gist (
    "venueId" WITH =,
    tsrange("startTime", "endTime", '[)') WITH &&
  );
