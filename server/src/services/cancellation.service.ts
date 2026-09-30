// Cancellation policy: tiers like [{ hoursBefore: 24, refundPercent: 100 },
// { hoursBefore: 6, refundPercent: 50 }]. The first tier whose hoursBefore
// the cancellation still meets applies; later than every tier refunds 0 %.
// No policy means a full refund. The refund is recorded now and paid out
// once online payments exist (Phase 8).

export interface CancellationTier {
  hoursBefore: number;
  refundPercent: number;
}

export interface RefundQuote {
  refundPercent: number;
  refundAmount: number;
  hoursBeforeStart: number;
  reason: string;
}

export function parsePolicy(policy: unknown): CancellationTier[] | null {
  if (!Array.isArray(policy)) return null;

  return policy
    .filter(
      (tier): tier is CancellationTier =>
        typeof tier?.hoursBefore === "number" && typeof tier?.refundPercent === "number"
    )
    .sort((a, b) => b.hoursBefore - a.hoursBefore);
}

export function quoteRefund(options: {
  policy: unknown;
  startTime: Date;
  totalPrice: number;
  status: string;
  /** The venue owner or an admin is cancelling. */
  cancelledByVenue: boolean;
  now?: Date;
}): RefundQuote {
  const now = options.now ?? new Date();
  const hoursBeforeStart = (options.startTime.getTime() - now.getTime()) / 3_600_000;
  const full = (reason: string) => ({
    refundPercent: 100,
    refundAmount: options.totalPrice,
    hoursBeforeStart,
    reason,
  });

  if (options.cancelledByVenue) return full("Cancelled by the venue");
  if (options.status === "PENDING") return full("The venue hadn't confirmed yet");

  const tiers = parsePolicy(options.policy);
  if (!tiers || tiers.length === 0) return full("Free cancellation");

  const tier = tiers.find((candidate) => hoursBeforeStart >= candidate.hoursBefore);
  const refundPercent = tier?.refundPercent ?? 0;

  return {
    refundPercent,
    refundAmount: Math.round(options.totalPrice * refundPercent) / 100,
    hoursBeforeStart,
    reason: tier
      ? `Cancelled at least ${tier.hoursBefore} hours before the start`
      : `Cancelled less than ${tiers.at(-1)!.hoursBefore} hours before the start`,
  };
}
