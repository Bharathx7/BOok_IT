import { z } from "zod";
import { isValidTimeZone } from "../utils/datetime.js";

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const shortList = (max: number, itemMax = 50) =>
  z
    .array(z.string().trim().min(1).max(itemMax))
    .max(max, `At most ${max} items`)
    .transform((items) => [...new Set(items)]);

const dayHours = z
  .object({
    open: z.string().regex(HH_MM, "Use HH:mm"),
    close: z.string().regex(HH_MM, "Use HH:mm"),
  })
  .refine(({ open, close }) => open < close, "Closing time must be after opening time")
  .nullable();

// { mon: { open, close } | null (closed), ... } - days left out are unknown.
const openingHours = z
  .object({
    mon: dayHours.optional(),
    tue: dayHours.optional(),
    wed: dayHours.optional(),
    thu: dayHours.optional(),
    fri: dayHours.optional(),
    sat: dayHours.optional(),
    sun: dayHours.optional(),
  })
  .strict();

export const OPENING_DAYS = DAYS;

const venueFields = {
  name: z
    .string()
    .trim()
    .min(2, "Venue name must be at least 2 characters")
    .max(200, "Venue name is too long"),

  description: z
    .string()
    .max(5000, "Description is too long")
    .optional(),

  category: z
    .string()
    .min(2, "Category must be at least 2 characters")
    .max(50, "Category is too long")
    .optional(),

  address: z
    .string()
    .max(500, "Address is too long")
    .optional(),

  city: z.string().trim().max(100, "City is too long").optional(),

  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),

  sportTypes: shortList(10).optional(),
  amenities: shortList(30).optional(),
  rules: z.string().max(2000, "Rules are too long").nullable().optional(),
  openingHours: openingHours.nullable().optional(),
  isActive: z.boolean().optional(),
  // Customers pay when booking (if online payments are switched on) or at the venue.
  paymentMode: z.enum(["PAY_AT_VENUE", "PAY_ONLINE"]).optional(),

  pricePerHour: z
    .number()
    .min(0, "Price cannot be negative")
    .max(1_000_000, "Price is too high"),

  timezone: z
    .string()
    .refine(isValidTimeZone, "Invalid IANA timezone, e.g. Asia/Kolkata")
    .optional(),

  // Bookings are made in steps of slotMinutes (also the shortest booking).
  slotMinutes: z
    .number()
    .int()
    .refine((value) => [15, 30, 45, 60, 90, 120].includes(value), "Choose 15, 30, 45, 60, 90 or 120 minutes")
    .optional(),
  maxBookingMinutes: z.number().int().min(15).max(12 * 60).optional(),

  // Refund tiers, e.g. [{ hoursBefore: 24, refundPercent: 100 }, { hoursBefore: 6, refundPercent: 50 }].
  cancellationPolicy: z
    .array(
      z.object({
        hoursBefore: z.number().min(0).max(24 * 30),
        refundPercent: z.number().int().min(0).max(100),
      })
    )
    .max(5, "At most 5 tiers")
    .refine(
      (tiers) => new Set(tiers.map((tier) => tier.hoursBefore)).size === tiers.length,
      "Each tier needs a different number of hours"
    )
    .nullable()
    .optional(),

  // How long the owner has to confirm a request: 15 minutes to 7 days.
  pendingHoldMinutes: z
    .number()
    .int("Must be a whole number of minutes")
    .min(15, "Allow at least 15 minutes to confirm")
    .max(7 * 24 * 60, "Can't be more than 7 days")
    .optional(),
};

// A map pin needs both coordinates (or neither).
const pinIsComplete = (data: {
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
}) =>
  (data.latitude === undefined) === (data.longitude === undefined) &&
  (data.latitude === null) === (data.longitude === null);

const pinMessage = { message: "Send latitude and longitude together", path: ["latitude"] };

const bookingLengthOk = (data: { slotMinutes?: number | undefined; maxBookingMinutes?: number | undefined }) =>
  data.slotMinutes === undefined ||
  data.maxBookingMinutes === undefined ||
  (data.maxBookingMinutes >= data.slotMinutes && data.maxBookingMinutes % data.slotMinutes === 0);

const bookingLengthMessage = {
  message: "The longest booking must be a multiple of the booking step",
  path: ["maxBookingMinutes"],
};

export const createVenueSchema = z
  .object(venueFields)
  .strict()
  .refine(pinIsComplete, pinMessage)
  .refine(bookingLengthOk, bookingLengthMessage);

export const updateVenueSchema = z
  .object(venueFields)
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  })
  .refine(pinIsComplete, pinMessage)
  .refine(bookingLengthOk, bookingLengthMessage);

// Query-string helpers: empty values count as "not given".
const blankToUndefined = (value: unknown) =>
  value === "" || (typeof value === "string" && value.trim() === "") ? undefined : value;

const queryNumber = (schema: z.ZodNumber) =>
  z.preprocess(blankToUndefined, z.coerce.number().pipe(schema).optional());

const queryText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

/** Query string of GET /api/venues. */
export const venueSearchSchema = z
  .object({
    q: queryText(100),
    sport: queryText(50),
    city: queryText(100),
    minPrice: queryNumber(z.number().min(0)),
    maxPrice: queryNumber(z.number().min(0)),
    minRating: queryNumber(z.number().min(0).max(5)),
    amenities: z.preprocess(
      (value) =>
        typeof value === "string"
          ? value.split(",").map((item) => item.trim()).filter(Boolean)
          : value,
      z.array(z.string().max(50)).max(20).optional()
    ),
    date: z.preprocess(
      blankToUndefined,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
        .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Invalid date")
        .optional()
    ),
    time: z.preprocess(blankToUndefined, z.string().regex(HH_MM, "Use HH:mm").optional()),
    duration: queryNumber(z.number().int().min(30).max(12 * 60)),
    lat: queryNumber(z.number().min(-90).max(90)),
    lng: queryNumber(z.number().min(-180).max(180)),
    radiusKm: queryNumber(z.number().min(1).max(100)),
    sort: z.preprocess(
      blankToUndefined,
      z
        .enum(["recommended", "relevance", "price_asc", "price_desc", "rating", "distance", "popular", "newest"])
        .optional()
    ),
  })
  .refine((data) => !data.time || data.date, { message: "A time needs a date", path: ["time"] })
  .refine((data) => (data.lat === undefined) === (data.lng === undefined), {
    message: "Send lat and lng together",
    path: ["lat"],
  })
  .refine(
    (data) =>
      data.minPrice === undefined || data.maxPrice === undefined || data.minPrice <= data.maxPrice,
    { message: "Minimum price is above the maximum", path: ["minPrice"] }
  );

export const reorderImagesSchema = z.object({
  imageIds: z.array(z.string().uuid()).min(1).max(50),
});
