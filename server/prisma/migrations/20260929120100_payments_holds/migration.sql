-- Separate from 20260929120000_payments: a new enum value can only be used
-- once the transaction that added it has committed.

-- A booking waiting for its payment holds the time like a pending request,
-- so two customers can't pay for the same slot.
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_no_overlap";
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap"
  EXCLUDE USING gist (
    "venueId" WITH =,
    tsrange("startTime", "endTime", '[)') WITH &&
  )
  WHERE ("status" IN ('AWAITING_PAYMENT', 'PENDING', 'CONFIRMED'));

-- A payment is recorded as a sale for the provider once, even if the webhook
-- and the checkout callback both report it.
CREATE UNIQUE INDEX "LedgerEntry_one_sale_per_payment" ON "LedgerEntry"("paymentId") WHERE "type" = 'SALE';
