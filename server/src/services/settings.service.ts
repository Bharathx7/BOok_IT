import { z } from "zod";

import prisma from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { ValidationError } from "../utils/errors.js";
import { changedFields, recordAudit } from "./audit.service.js";

// Platform settings: a fixed list of keys, each with a default and a schema.
// Stored rows override the defaults; unknown keys are rejected.

export const SETTINGS = {
  requireVenueApproval: {
    label: "New venues need admin approval",
    description: "Venues listed by providers stay hidden until an admin approves them.",
    schema: z.boolean(),
    default: true,
  },
  commissionPercent: {
    label: "Platform commission (%)",
    description: "Share of each booking the platform keeps. Used in reports now and for payouts once payments launch.",
    schema: z.number().min(0).max(50),
    default: 10,
  },
  defaultPendingHoldMinutes: {
    label: "Default confirmation window (minutes)",
    description: "How long a new venue's owner has to confirm a request, unless they change it.",
    schema: z.number().int().min(15).max(7 * 24 * 60),
    default: 1440,
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type Settings = { [K in SettingKey]: z.infer<(typeof SETTINGS)[K]["schema"]> };

const KEYS = Object.keys(SETTINGS) as SettingKey[];

export async function getSettings(): Promise<Settings> {
  const rows = await prisma.platformSetting.findMany({ where: { key: { in: KEYS } } });
  const stored = new Map(rows.map((row) => [row.key, row.value]));

  return Object.fromEntries(
    KEYS.map((key) => {
      const parsed = SETTINGS[key].schema.safeParse(stored.get(key));
      // A stored value that no longer fits the schema falls back to the default.
      return [key, parsed.success ? parsed.data : SETTINGS[key].default];
    })
  ) as Settings;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<Settings[K]> {
  return (await getSettings())[key];
}

/** For the admin page: current values plus labels and defaults. */
export async function describeSettings() {
  const values = await getSettings();
  return KEYS.map((key) => ({
    key,
    label: SETTINGS[key].label,
    description: SETTINGS[key].description,
    default: SETTINGS[key].default,
    value: values[key],
  }));
}

export async function updateSettings(changes: Record<string, unknown>, actorId: string) {
  const unknown = Object.keys(changes).filter((key) => !KEYS.includes(key as SettingKey));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown setting: ${unknown.join(", ")}`);
  }

  const errors: { field: string; message: string }[] = [];
  const valid: Partial<Record<SettingKey, unknown>> = {};

  for (const key of Object.keys(changes) as SettingKey[]) {
    const parsed = SETTINGS[key].schema.safeParse(changes[key]);
    if (parsed.success) valid[key] = parsed.data;
    else errors.push({ field: key, message: parsed.error.issues[0]?.message ?? "Invalid value" });
  }

  if (errors.length > 0) throw new ValidationError("Some settings are invalid", errors);

  const before = await getSettings();

  await prisma.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(valid)) {
      await tx.platformSetting.upsert({
        where: { key },
        update: { value: value as Prisma.InputJsonValue, updatedById: actorId },
        create: { key, value: value as Prisma.InputJsonValue, updatedById: actorId },
      });
    }

    const after = { ...before, ...valid };
    const diff = changedFields(before, after);
    if (Object.keys(diff.after).length > 0) {
      await recordAudit({ action: "settings.updated", entityType: "PlatformSetting", ...diff }, tx);
    }
  });

  return describeSettings();
}
