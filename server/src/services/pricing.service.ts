import prisma from "../config/prisma.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";
import { dateOnlyKey, localParts, timeToMinutes } from "../utils/datetime.js";

// Booking prices are worked out in 5-minute steps in the venue's local time.
// For each step the highest-priority matching rule sets the hourly rate
// (FIXED = that many rupees per hour, MULTIPLIER = base price x value);
// with no match the venue's base price applies. Consecutive steps at the
// same rate are merged into one line of the breakdown.

const STEP_MINUTES = 5;
const MINUTE = 60 * 1000;

export interface PriceRule {
  id: string;
  name: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  validFrom: Date | null;
  validTo: Date | null;
  type: "FIXED" | "MULTIPLIER";
  value: number;
  priority: number;
  isActive: boolean;
}

export interface PriceLine {
  label: string;
  ruleId: string | null;
  start: string;
  end: string;
  ratePerHour: number;
  amount: number;
}

export interface PriceQuote {
  total: number;
  basePricePerHour: number;
  breakdown: PriceLine[];
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

/** Does the rule cover this local moment? Supports overnight ranges like 22:00-02:00. */
export function ruleApplies(rule: PriceRule, weekday: number, minutes: number, dateKey: string) {
  if (!rule.isActive) return false;
  if (rule.validFrom && dateKey < dateOnlyKey(rule.validFrom)) return false;
  if (rule.validTo && dateKey > dateOnlyKey(rule.validTo)) return false;

  const start = timeToMinutes(rule.startTime);
  const end = timeToMinutes(rule.endTime);
  const overnight = end <= start;
  const inTime = overnight ? minutes >= start || minutes < end : minutes >= start && minutes < end;
  if (!inTime) return false;

  if (rule.daysOfWeek.length === 0) return true;
  // After midnight in an overnight rule, the rule "belongs" to the previous day.
  const ruleDay = overnight && minutes < end ? (weekday + 6) % 7 : weekday;
  return rule.daysOfWeek.includes(ruleDay);
}

export function calculatePrice(
  basePricePerHour: number,
  rules: PriceRule[],
  start: Date,
  end: Date,
  timeZone: string
): PriceQuote {
  if (end <= start) {
    throw new ValidationError("End time must be after start time");
  }

  const ordered = [...rules].sort((a, b) => b.priority - a.priority);
  const breakdown: PriceLine[] = [];
  let cursor = start.getTime();

  while (cursor < end.getTime()) {
    const stepEnd = Math.min(cursor + STEP_MINUTES * MINUTE, end.getTime());
    const local = localParts(new Date(cursor), timeZone);
    const rule = ordered.find((candidate) =>
      ruleApplies(candidate, local.weekday, local.minutes, local.dateKey)
    );

    const ratePerHour = rule
      ? rule.type === "FIXED"
        ? rule.value
        : basePricePerHour * rule.value
      : basePricePerHour;
    const amount = (ratePerHour * (stepEnd - cursor)) / (60 * MINUTE);
    const label = rule?.name ?? "Standard rate";
    const last = breakdown.at(-1);

    if (last && last.label === label && last.ratePerHour === roundMoney(ratePerHour)) {
      last.end = new Date(stepEnd).toISOString();
      last.amount += amount;
    } else {
      breakdown.push({
        label,
        ruleId: rule?.id ?? null,
        start: new Date(cursor).toISOString(),
        end: new Date(stepEnd).toISOString(),
        ratePerHour: roundMoney(ratePerHour),
        amount,
      });
    }

    cursor = stepEnd;
  }

  for (const line of breakdown) line.amount = roundMoney(line.amount);

  return {
    total: roundMoney(breakdown.reduce((sum, line) => sum + line.amount, 0)),
    basePricePerHour,
    breakdown,
  };
}

export const toPriceRule = (rule: {
  id: string;
  name: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  validFrom: Date | null;
  validTo: Date | null;
  type: "FIXED" | "MULTIPLIER";
  value: { toString(): string } | number;
  priority: number;
  isActive: boolean;
}): PriceRule => ({ ...rule, value: Number(rule.value) });

/** Quote for a venue using its current rules (booking page, editor preview). */
export async function quoteForVenue(venueId: string, start: Date, end: Date) {
  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    include: { pricingRules: { where: { isActive: true } } },
  });

  if (!venue) {
    throw new NotFoundError("Venue not found");
  }

  return calculatePrice(
    Number(venue.pricePerHour),
    venue.pricingRules.map(toPriceRule),
    start,
    end,
    venue.timezone
  );
}
