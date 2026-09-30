import { currentLocale, translate } from "../i18n/translate";

// Timestamps come from the API in UTC. Anything tied to a venue (slots,
// bookings) is shown in the venue's timezone rather than the browser's, so a
// customer abroad and the venue owner see the same "6:00 pm".

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

type DateInput = string | number | Date;
type TimeZone = string | null | undefined;

const resolveTimeZone = (timeZone: TimeZone) => timeZone || DEFAULT_TIMEZONE;

const formatters = new Map<string, Intl.DateTimeFormat>();

// Intl.DateTimeFormat is expensive to construct, so reuse them. Display
// formats follow the chosen language; parsing uses a fixed locale.
function getFormatter(
  timeZone: TimeZone,
  options: Intl.DateTimeFormatOptions,
  locale: string = currentLocale()
) {
  const zone = resolveTimeZone(timeZone);
  const key = `${locale}|${zone}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: zone });
    formatters.set(key, formatter);
  }

  return formatter;
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
};

const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

/** "Sat, 16 Aug 2026, 6:00 pm IST" */
export function formatDateTime(value: DateInput, timeZone: TimeZone) {
  return getFormatter(timeZone, {
    ...DATE_OPTIONS,
    ...TIME_OPTIONS,
    timeZoneName: "short",
  }).format(new Date(value));
}

/** "Sat, 16 Aug 2026" */
export function formatDate(value: DateInput, timeZone: TimeZone) {
  return getFormatter(timeZone, DATE_OPTIONS).format(new Date(value));
}

/** "6:00 pm" */
export function formatTime(value: DateInput, timeZone: TimeZone) {
  return getFormatter(timeZone, TIME_OPTIONS).format(new Date(value));
}

/** The pieces of a date for a calendar-style badge: { month: "Aug", day: "16", weekday: "Sat" }. */
export function dateParts(value: DateInput, timeZone: TimeZone) {
  const date = new Date(value);
  return {
    month: getFormatter(timeZone, { month: "short" }).format(date),
    day: getFormatter(timeZone, { day: "numeric" }).format(date),
    weekday: getFormatter(timeZone, { weekday: "short" }).format(date),
  };
}

/** "6:00 pm – 7:00 pm IST": the time of day only, for when the date is shown elsewhere. */
export function formatHours(start: DateInput, end: DateInput, timeZone: TimeZone) {
  return `${formatTime(start, timeZone)} – ${formatTime(end, timeZone)} ${timeZoneLabel(timeZone, start)}`;
}

/**
 * "Sat, 16 Aug 2026, 6:00 pm – 7:00 pm IST", or both full date-times when the
 * range crosses midnight in the venue's timezone.
 */
export function formatTimeRange(start: DateInput, end: DateInput, timeZone: TimeZone) {
  if (dateKeyInTimeZone(start, timeZone) !== dateKeyInTimeZone(end, timeZone)) {
    return `${formatDateTime(start, timeZone)} – ${formatDateTime(end, timeZone)}`;
  }

  return `${formatDate(start, timeZone)}, ${formatTime(start, timeZone)} – ${formatTime(
    end,
    timeZone
  )} ${timeZoneLabel(timeZone, start)}`;
}

/** Short zone name such as "IST" (or "GMT+5:30" where no abbreviation exists). */
export function timeZoneLabel(timeZone: TimeZone, at: DateInput = new Date()) {
  const part = getFormatter(timeZone, { timeZoneName: "short" })
    .formatToParts(new Date(at))
    .find((item) => item.type === "timeZoneName");

  return part?.value ?? resolveTimeZone(timeZone);
}

function getZonedParts(value: DateInput, timeZone: TimeZone) {
  const parts = getFormatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }, "en-US").formatToParts(new Date(value));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Calendar day of an instant in the given timezone, as "YYYY-MM-DD". */
export function dateKeyInTimeZone(value: DateInput, timeZone: TimeZone) {
  const { year, month, day } = getZonedParts(value, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Wall-clock time of an instant in the given timezone, as "HH:mm". */
export function timeInTimeZone(value: DateInput, timeZone: TimeZone) {
  const { hour, minute } = getZonedParts(value, timeZone);
  return `${pad(hour)}:${pad(minute)}`;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
export function timeAgo(value: DateInput, now: Date = new Date()) {
  const seconds = Math.round((now.getTime() - new Date(value).getTime()) / 1000);

  if (seconds < 60) return translate("time.justNow");
  if (seconds < 3600) return translate("time.minutesAgo", { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return translate("time.hoursAgo", { count: Math.floor(seconds / 3600) });
  if (seconds < 7 * 86400) return translate("time.daysAgo", { count: Math.floor(seconds / 86400) });

  return new Date(value).toLocaleDateString(currentLocale(), { day: "numeric", month: "short" });
}

/** Today's date in the given timezone, as "YYYY-MM-DD". */
export function todayKeyInTimeZone(timeZone: TimeZone) {
  return dateKeyInTimeZone(new Date(), timeZone);
}

// How far the timezone's wall clock is ahead of UTC at the given instant.
function offsetMs(instant: number, timeZone: TimeZone) {
  const { year, month, day, hour, minute, second } = getZonedParts(instant, timeZone);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return wallClockAsUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Converts a wall-clock date and time in the given timezone to the UTC instant,
 * e.g. ("2026-08-16", "18:00", "Asia/Kolkata") -> 2026-08-16T12:30:00Z.
 */
export function zonedTimeToUtc(dateKey: string, time: string, timeZone: TimeZone) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);

  // Guess with the offset at that moment, then correct once in case the guess
  // landed on the other side of a DST change.
  const firstGuess = wallClockAsUtc - offsetMs(wallClockAsUtc, timeZone);
  const corrected = wallClockAsUtc - offsetMs(firstGuess, timeZone);

  return new Date(corrected);
}
