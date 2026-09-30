-- CreateEnum
CREATE TYPE "PricingRuleType" AS ENUM ('FIXED', 'MULTIPLIER');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('ONLINE', 'WALK_IN', 'BLOCK');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "guestName" TEXT,
ADD COLUMN     "guestPhone" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "priceBreakdown" JSONB,
ADD COLUMN     "refundAmount" DECIMAL(65,30),
ADD COLUMN     "refundPercent" INTEGER,
ADD COLUMN     "source" "BookingSource" NOT NULL DEFAULT 'ONLINE',
ADD COLUMN     "totalPrice" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "providerRepliedAt" TIMESTAMP(3),
ADD COLUMN     "providerReply" TEXT;

-- AlterTable
ALTER TABLE "TimeSlot" ADD COLUMN     "templateId" TEXT;

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "cancellationPolicy" JSONB,
ADD COLUMN     "maxBookingMinutes" INTEGER NOT NULL DEFAULT 240,
ADD COLUMN     "slotMinutes" INTEGER NOT NULL DEFAULT 60;

-- CreateTable
CREATE TABLE "SlotTemplate" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT,
    "daysOfWeek" INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "validFrom" DATE,
    "validTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlotTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlackoutDate" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlackoutDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "validFrom" DATE,
    "validTo" DATE,
    "type" "PricingRuleType" NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlotTemplate_venueId_idx" ON "SlotTemplate"("venueId");

-- CreateIndex
CREATE INDEX "BlackoutDate_venueId_startTime_idx" ON "BlackoutDate"("venueId", "startTime");

-- CreateIndex
CREATE INDEX "PricingRule_venueId_idx" ON "PricingRule"("venueId");

-- AddForeignKey
ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SlotTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotTemplate" ADD CONSTRAINT "SlotTemplate_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlackoutDate" ADD CONSTRAINT "BlackoutDate_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing bookings get a price at the venue's base rate, so revenue reports
-- cover them too.
UPDATE "Booking" b
SET "totalPrice" = ROUND(v."pricePerHour" * EXTRACT(EPOCH FROM (b."endTime" - b."startTime")) / 3600, 2),
    "priceBreakdown" = jsonb_build_array(jsonb_build_object(
      'label', 'Standard rate',
      'start', to_char(b."startTime", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'end', to_char(b."endTime", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ratePerHour', v."pricePerHour",
      'amount', ROUND(v."pricePerHour" * EXTRACT(EPOCH FROM (b."endTime" - b."startTime")) / 3600, 2)
    ))
FROM "Venue" v
WHERE v.id = b."venueId" AND b."totalPrice" IS NULL;

UPDATE "Booking" SET "cancelledAt" = "updatedAt" WHERE "status" = 'CANCELLED' AND "cancelledAt" IS NULL;
