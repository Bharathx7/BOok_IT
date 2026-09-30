import type { MessageKey } from "../i18n/en";
import { translate, translateOr } from "../i18n/translate";
import type { DayKey, VenueSort } from "../services/venue.api";

export const SPORTS = [
  "Football",
  "Cricket",
  "Badminton",
  "Tennis",
  "Basketball",
  "Volleyball",
  "Table Tennis",
  "Swimming",
  "Pickleball",
  "Squash",
];

export const AMENITIES = [
  "Parking",
  "Floodlights",
  "Changing rooms",
  "Showers",
  "Drinking water",
  "Washrooms",
  "Equipment rental",
  "Cafeteria",
  "First aid",
  "Seating area",
  "Air conditioning",
  "Wheelchair access",
];

// Labels are message keys; pass them through t().
export const DAYS: { key: DayKey; label: MessageKey; short: MessageKey }[] = (
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
).map((key) => ({ key, label: `day.${key}`, short: `dayShort.${key}` }));

export const SORT_OPTIONS: { value: VenueSort; label: MessageKey }[] = (
  ["recommended", "rating", "popular", "price_asc", "price_desc", "distance", "newest"] as const
).map((value) => ({ value, label: `sort.${value}` }));

export const DURATIONS: { minutes: number; label: MessageKey }[] = ([60, 90, 120, 180] as const).map(
  (minutes) => ({ minutes, label: `duration.${minutes}` })
);

const JS_WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Short weekday name for a JS weekday number (0 = Sunday), translated. */
export const weekdayShort = (day: number) => translate(`dayShort.${JS_WEEKDAYS[day]!}`);

/** Sports and amenities are stored in English; these show them translated. */
export const sportLabel = (sport: string) => translateOr(`sport.${sport}`, sport);
export const amenityLabel = (amenity: string) => translateOr(`amenity.${amenity}`, amenity);

/** "4.5" or "New" when there are no reviews yet. */
export const ratingLabel = (avgRating: number, reviewCount: number) =>
  reviewCount === 0 ? translate("venue.new") : avgRating.toFixed(1);

/** Today's local date as YYYY-MM-DD, for <input type="date" min>. */
export const todayInputValue = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
