import prisma from "../config/prisma.js";
import { QUEUES, registerHandler } from "../jobs/queue.js";
import { processWaitlist } from "./waitlist.service.js";
import { findViewableVenue } from "./venueVisibility.js";
import type { Prisma, PricingRuleType } from "../generated/prisma/client.js";
import {
  addDaysToKey,
  dateOnlyKey,
  localParts,
  timeToMinutes,
  weekdayOfKey,
  zonedTimeToUtc,
} from "../utils/datetime.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { HOLDING_STATUSES, holdsTimeWhere } from "./bookingHolds.js";

export const MAX_GENERATE_DAYS = 90;
/** How far ahead the nightly job keeps template slots filled in. */
export const ROLLING_HORIZON_DAYS = 30;

export async function assertVenueManager(venueId: string, userId: string, isAdmin: boolean) {
  const venue = await prisma.venue.findUnique({ where: { id: venueId } });

  if (!venue) {
    throw new NotFoundError("Venue not found");
  }

  if (!isAdmin && venue.ownerId !== userId) {
    throw new ForbiddenError("You do not have permission to manage this venue");
  }

  return venue;
}

// ---------------------------------------------------------------------------
// Slot templates
// ---------------------------------------------------------------------------

export interface TemplateInput {
  name?: string | null | undefined;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  validFrom?: string | null | undefined;
  validTo?: string | null | undefined;
  isActive?: boolean | undefined;
}

/** "YYYY-MM-DD" -> @db.Date value; null clears it. */
const toDbDate = (value: string | null) => (value === null ? null : new Date(`${value}T00:00:00Z`));

const templateData = (input: Partial<TemplateInput>) => ({
  ...(input.name !== undefined && { name: input.name }),
  ...(input.daysOfWeek !== undefined && { daysOfWeek: input.daysOfWeek }),
  ...(input.startTime !== undefined && { startTime: input.startTime }),
  ...(input.endTime !== undefined && { endTime: input.endTime }),
  ...(input.validFrom !== undefined && { validFrom: toDbDate(input.validFrom) }),
  ...(input.validTo !== undefined && { validTo: toDbDate(input.validTo) }),
  ...(input.isActive !== undefined && { isActive: input.isActive }),
});

export const listTemplates = (venueId: string) =>
  prisma.slotTemplate.findMany({ where: { venueId }, orderBy: { createdAt: "asc" } });

export const createTemplate = (venueId: string, input: TemplateInput) =>
  prisma.slotTemplate.create({ data: { venueId, ...templateData(input) } as Prisma.SlotTemplateUncheckedCreateInput });

export async function updateTemplate(venueId: string, templateId: string, input: Partial<TemplateInput>) {
  const template = await prisma.slotTemplate.findFirst({ where: { id: templateId, venueId } });
  if (!template) throw new NotFoundError("Template not found");

  return prisma.slotTemplate.update({ where: { id: templateId }, data: templateData(input) });
}

/** Deletes a template; optionally also its future slots (past ones are history). */
export async function deleteTemplate(venueId: string, templateId: string, removeFutureSlots: boolean) {
  const template = await prisma.slotTemplate.findFirst({ where: { id: templateId, venueId } });
  if (!template) throw new NotFoundError("Template not found");

  let removedSlots = 0;
  if (removeFutureSlots) {
    ({ count: removedSlots } = await prisma.timeSlot.deleteMany({
      where: { templateId, startTime: { gt: new Date() } },
    }));
  }

  await prisma.slotTemplate.delete({ where: { id: templateId } });
  return { removedSlots };
}

interface PlannedSlot {
  templateId: string;
  date: string;
  startTime: Date;
  endTime: Date;
}

export interface GenerationResult {
  created: number;
  skipped: { date: string; startTime: string; endTime: string; reason: string }[];
  planned: { date: string; startTime: string; endTime: string }[];
}

/**
 * Turns templates into TimeSlots for each matching day from `fromDate` for
 * `days` days. Days that already have an overlapping slot are skipped, so
 * running it twice is harmless. With `dryRun` nothing is saved (preview).
 */
export async function generateSlots(
  venueId: string,
  options: { fromDate?: string | undefined; days: number; templateIds?: string[] | undefined; dryRun?: boolean | undefined }
): Promise<GenerationResult> {
  const venue = await prisma.venue.findUnique({ where: { id: venueId } });
  if (!venue) throw new NotFoundError("Venue not found");

  const days = Math.min(Math.max(options.days, 1), MAX_GENERATE_DAYS);
  const todayKey = localParts(new Date(), venue.timezone).dateKey;
  const fromKey = options.fromDate && options.fromDate > todayKey ? options.fromDate : todayKey;

  const templates = await prisma.slotTemplate.findMany({
    where: {
      venueId,
      isActive: true,
      ...(options.templateIds?.length && { id: { in: options.templateIds } }),
    },
  });

  const planned: PlannedSlot[] = [];
  const now = new Date();

  for (let offset = 0; offset < days; offset++) {
    const dateKey = addDaysToKey(fromKey, offset);
    const weekday = weekdayOfKey(dateKey);

    for (const template of templates) {
      if (!template.daysOfWeek.includes(weekday)) continue;
      if (template.validFrom && dateKey < dateOnlyKey(template.validFrom)) continue;
      if (template.validTo && dateKey > dateOnlyKey(template.validTo)) continue;

      const startTime = zonedTimeToUtc(dateKey, template.startTime, venue.timezone);
      const endTime =
        template.endTime === "24:00"
          ? zonedTimeToUtc(addDaysToKey(dateKey, 1), "00:00", venue.timezone)
          : zonedTimeToUtc(dateKey, template.endTime, venue.timezone);

      // Today's window that has already ended is pointless.
      if (endTime <= now) continue;

      planned.push({ templateId: template.id, date: dateKey, startTime, endTime });
    }
  }

  if (planned.length === 0) {
    return { created: 0, skipped: [], planned: [] };
  }

  const rangeStart = planned.reduce((min, slot) => (slot.startTime < min ? slot.startTime : min), planned[0]!.startTime);
  const rangeEnd = planned.reduce((max, slot) => (slot.endTime > max ? slot.endTime : max), planned[0]!.endTime);

  const existing = await prisma.timeSlot.findMany({
    where: { venueId, startTime: { lt: rangeEnd }, endTime: { gt: rangeStart } },
    select: { startTime: true, endTime: true },
  });

  const taken = [...existing];
  const toCreate: PlannedSlot[] = [];
  const skipped: GenerationResult["skipped"] = [];
  const hhmm = (date: Date) => {
    const minutes = localParts(date, venue.timezone).minutes;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  };

  for (const slot of planned) {
    const clash = taken.some((other) => other.startTime < slot.endTime && other.endTime > slot.startTime);

    if (clash) {
      skipped.push({
        date: slot.date,
        startTime: hhmm(slot.startTime),
        endTime: hhmm(slot.endTime),
        reason: "Overlaps an existing slot",
      });
    } else {
      toCreate.push(slot);
      taken.push(slot);
    }
  }

  if (!options.dryRun && toCreate.length > 0) {
    await prisma.timeSlot.createMany({
      data: toCreate.map(({ templateId, startTime, endTime }) => ({ venueId, templateId, startTime, endTime })),
    });
  }

  return {
    created: options.dryRun ? 0 : toCreate.length,
    skipped,
    planned: toCreate.map((slot) => ({
      date: slot.date,
      startTime: hhmm(slot.startTime),
      endTime: hhmm(slot.endTime),
    })),
  };
}

/** Nightly: keep every venue with active templates filled 30 days ahead. */
export async function extendTemplateSlots() {
  const venues = await prisma.slotTemplate.findMany({
    where: { isActive: true },
    distinct: ["venueId"],
    select: { venueId: true },
  });

  let created = 0;
  for (const { venueId } of venues) {
    try {
      created += (await generateSlots(venueId, { days: ROLLING_HORIZON_DAYS })).created;
    } catch (error) {
      logger.error({ err: error, venueId }, "Slot generation failed");
    }
  }

  if (created > 0) logger.info({ created }, "Template slots extended");
  return created;
}

// ---------------------------------------------------------------------------
// Blackouts
// ---------------------------------------------------------------------------

export const listBlackouts = (venueId: string, includePast = false) =>
  prisma.blackoutDate.findMany({
    where: { venueId, ...(!includePast && { endTime: { gt: new Date() } }) },
    orderBy: { startTime: "asc" },
  });

export async function createBlackout(
  venueId: string,
  input: { startTime: Date; endTime: Date; reason?: string | null | undefined }
) {
  if (input.endTime <= input.startTime) {
    throw new ValidationError("The end must be after the start");
  }

  const blackout = await prisma.blackoutDate.create({
    data: { venueId, startTime: input.startTime, endTime: input.endTime, reason: input.reason ?? null },
  });

  // Existing bookings stay valid; tell the owner how many need handling.
  const affectedBookings = await prisma.booking.count({
    where: {
      venueId,
      status: { in: [...HOLDING_STATUSES] },
      source: { not: "BLOCK" },
      startTime: { lt: input.endTime },
      endTime: { gt: input.startTime },
    },
  });

  return { blackout, affectedBookings };
}

export async function deleteBlackout(venueId: string, blackoutId: string) {
  const blackout = await prisma.blackoutDate.findFirst({ where: { id: blackoutId, venueId } });
  if (!blackout) throw new NotFoundError("Blackout not found");

  await prisma.blackoutDate.delete({ where: { id: blackoutId } });
  // The reopened time may be what someone on the waitlist wants.
  await processWaitlist(venueId, blackout.startTime, blackout.endTime).catch((error: unknown) =>
    logger.error({ err: error }, "Waitlist after closure removal failed")
  );
}

export const findBlackoutOverlap = (
  venueId: string,
  startTime: Date,
  endTime: Date,
  client: Pick<typeof prisma, "blackoutDate"> = prisma
) =>
  client.blackoutDate.findFirst({
    where: { venueId, startTime: { lt: endTime }, endTime: { gt: startTime } },
  });

// ---------------------------------------------------------------------------
// Pricing rules
// ---------------------------------------------------------------------------

export interface PricingRuleInput {
  name: string;
  daysOfWeek?: number[] | undefined;
  startTime: string;
  endTime: string;
  validFrom?: string | null | undefined;
  validTo?: string | null | undefined;
  type: PricingRuleType;
  value: number;
  priority?: number | undefined;
  isActive?: boolean | undefined;
}

const ruleData = (input: Partial<PricingRuleInput>) => ({
  ...(input.name !== undefined && { name: input.name }),
  ...(input.daysOfWeek !== undefined && { daysOfWeek: input.daysOfWeek }),
  ...(input.startTime !== undefined && { startTime: input.startTime }),
  ...(input.endTime !== undefined && { endTime: input.endTime }),
  ...(input.validFrom !== undefined && { validFrom: toDbDate(input.validFrom) }),
  ...(input.validTo !== undefined && { validTo: toDbDate(input.validTo) }),
  ...(input.type !== undefined && { type: input.type }),
  ...(input.value !== undefined && { value: input.value }),
  ...(input.priority !== undefined && { priority: input.priority }),
  ...(input.isActive !== undefined && { isActive: input.isActive }),
});

export const listPricingRules = (venueId: string) =>
  prisma.pricingRule.findMany({ where: { venueId }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] });

export const createPricingRule = (venueId: string, input: PricingRuleInput) =>
  prisma.pricingRule.create({ data: { venueId, ...ruleData(input) } as Prisma.PricingRuleUncheckedCreateInput });

export async function updatePricingRule(venueId: string, ruleId: string, input: Partial<PricingRuleInput>) {
  const rule = await prisma.pricingRule.findFirst({ where: { id: ruleId, venueId } });
  if (!rule) throw new NotFoundError("Pricing rule not found");
  return prisma.pricingRule.update({ where: { id: ruleId }, data: ruleData(input) });
}

export async function deletePricingRule(venueId: string, ruleId: string) {
  const { count } = await prisma.pricingRule.deleteMany({ where: { id: ruleId, venueId } });
  if (count === 0) throw new NotFoundError("Pricing rule not found");
}

// ---------------------------------------------------------------------------
// Public day schedule (booking page)
// ---------------------------------------------------------------------------

/**
 * Opening windows and busy periods for one local day. Busy periods carry no
 * personal data - just "booked" or "closed".
 */
export async function getDaySchedule(venueId: string, dateKey: string, viewer?: { id: string; role: string }) {
  const venue = await findViewableVenue(venueId, viewer);

  const dayStart = zonedTimeToUtc(dateKey, "00:00", venue.timezone);
  const dayEnd = zonedTimeToUtc(addDaysToKey(dateKey, 1), "00:00", venue.timezone);
  const now = new Date();

  const [slots, bookings, blackouts] = await Promise.all([
    prisma.timeSlot.findMany({
      where: { venueId, startTime: { lt: dayEnd }, endTime: { gt: dayStart } },
      orderBy: { startTime: "asc" },
      select: { startTime: true, endTime: true },
    }),
    prisma.booking.findMany({
      where: {
        venueId,
        startTime: { lt: dayEnd },
        endTime: { gt: dayStart },
        ...holdsTimeWhere(now),
      },
      select: { startTime: true, endTime: true },
    }),
    prisma.blackoutDate.findMany({
      where: { venueId, startTime: { lt: dayEnd }, endTime: { gt: dayStart } },
      select: { startTime: true, endTime: true, reason: true },
    }),
  ]);

  return {
    date: dateKey,
    timezone: venue.timezone,
    slotMinutes: venue.slotMinutes,
    maxBookingMinutes: venue.maxBookingMinutes,
    pricePerHour: Number(venue.pricePerHour),
    windows: slots,
    busy: [
      ...bookings.map((booking) => ({ ...booking, kind: "booked" as const })),
      ...blackouts.map((blackout) => ({
        startTime: blackout.startTime,
        endTime: blackout.endTime,
        kind: "closed" as const,
        reason: blackout.reason,
      })),
    ].sort((a, b) => a.startTime.getTime() - b.startTime.getTime()),
  };
}

export { timeToMinutes };

registerHandler(QUEUES.slotGeneration, () => extendTemplateSlots());
