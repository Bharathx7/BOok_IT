import { currentLocale } from "../i18n/translate";

// Calendar-grid helpers. These treat Date objects as plain calendar days;
// for instants tied to a venue use lib/datetime.ts instead.

export function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function toDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function isSameDay(left: Date, right: Date) {
  return toDateKey(left) === toDateKey(right);
}

export function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

export function formatLongDate(date: Date) {
  return date.toLocaleDateString(currentLocale(), {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function getCalendarCells(viewDate: Date) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);

    return {
      date,
      inMonth: date.getMonth() === month,
    };
  });
}

export function buildTimeOptions() {
  const options: string[] = [];

  for (let hour = 6; hour <= 22; hour += 1) {
    options.push(`${pad(hour)}:00`);
    if (hour < 22) {
      options.push(`${pad(hour)}:30`);
    }
  }

  return options;
}

