-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "avgRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "openingHours" JSONB,
ADD COLUMN     "reviewCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rules" TEXT,
ADD COLUMN     "sportTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "VenueImage" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "userId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("userId","venueId")
);

-- CreateIndex
CREATE INDEX "VenueImage_venueId_position_idx" ON "VenueImage"("venueId", "position");

-- CreateIndex
CREATE INDEX "Favorite_venueId_idx" ON "Favorite"("venueId");

-- CreateIndex
CREATE INDEX "Venue_isActive_city_idx" ON "Venue"("isActive", "city");

-- CreateIndex
CREATE INDEX "Venue_ownerId_idx" ON "Venue"("ownerId");

-- AddForeignKey
ALTER TABLE "VenueImage" ADD CONSTRAINT "VenueImage_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Each venue plays at least its main sport.
UPDATE "Venue" SET "sportTypes" = ARRAY["category"]
WHERE "category" IS NOT NULL AND "category" <> 'Other' AND cardinality("sportTypes") = 0;

-- Ratings are now stored on the venue so search can sort by them.
UPDATE "Venue" v
SET "avgRating" = r.avg, "reviewCount" = r.count
FROM (
  SELECT "venueId", ROUND(AVG("rating")::numeric, 2)::float8 AS avg, COUNT(*)::int AS count
  FROM "Review" GROUP BY "venueId"
) r
WHERE r."venueId" = v.id;

-- Full-text search over the listing text. The expression must match the one
-- used by the search query in venueSearch.service.ts.
CREATE INDEX "Venue_search_idx" ON "Venue" USING GIN (
  to_tsvector('simple'::regconfig,
    coalesce("name", '') || ' ' || coalesce("description", '') || ' ' ||
    coalesce("address", '') || ' ' || coalesce("city", ''))
);
