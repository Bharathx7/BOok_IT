export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export const isValidTimeZone = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

/**
 * Formats a UTC instant in the venue's local timezone, e.g.
 * "Sat, 16 Aug 2026, 6:00 pm IST". Dates are always stored in UTC.
 */
export const formatInTimeZone = (
  date: Date,
  timeZone: string = DEFAULT_TIMEZONE
) =>
  new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(date);

// ---------------------------------------------------------------------------
// Venue-local calendar maths. Dates are stored in UTC; opening hours, slot
// templates and pricing rules are written in the venue's local time.
// ---------------------------------------------------------------------------

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const pad = (value: number) => String(value).padStart(2, "0");

export interface LocalParts {
  /** "YYYY-MM-DD" in the venue's timezone. */
  dateKey: string;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
  hour: number;
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));

  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: WEEKDAYS[get("weekday")] ?? 0,
    minutes: hour * 60 + minute,
    hour,
  };
}

function offsetMs(instant: number, timeZone: string) {
  const parts = partsFormatter(timeZone).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Wall-clock "YYYY-MM-DD" + "HH:mm" (or "24:00") in a timezone -> UTC instant. */
export function zonedTimeToUtc(dateKey: string, time: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClock = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const firstGuess = wallClock - offsetMs(wallClock, timeZone);
  return new Date(wallClock - offsetMs(firstGuess, timeZone));
}

/** "YYYY-MM-DD" plus n days. */
export function addDaysToKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** "HH:mm" -> minutes since midnight ("24:00" -> 1440). */
export const timeToMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour! * 60 + minute!;
};

/** 0 = Sunday for a "YYYY-MM-DD" date key. */
export const weekdayOfKey = (dateKey: string) => new Date(`${dateKey}T00:00:00Z`).getUTCDay();

/** "YYYY-MM-DD" of a @db.Date value (stored as UTC midnight). */
export const dateOnlyKey = (date: Date) => date.toISOString().slice(0, 10);
