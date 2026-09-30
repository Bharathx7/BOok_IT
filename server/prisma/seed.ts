// Realistic demo data for local development: `npm run db:seed`.
//
// Creates providers, venues across eight cities, customers who signed up over
// the last six months, about four months of bookings (with real prices),
// reviews, coupons, and something in every admin queue. The data is the same
// on every run (seeded random numbers). Re-running replaces the demo data -
// every account on @bookit.local and what belongs to it - and leaves other
// accounts alone. Refuses to touch anything but a local database.
import bcrypt from "bcrypt";

import prisma from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { calculatePrice, toPriceRule } from "../src/services/pricing.service.js";
import { refreshVenueRating } from "../src/services/review.service.js";
import { newBookingCode } from "../src/utils/bookingCode.js";
import { addDaysToKey, localParts, zonedTimeToUtc } from "../src/utils/datetime.js";

const host = new URL(env.DATABASE_URL).hostname;
if (!["localhost", "127.0.0.1"].includes(host)) {
  console.error(`Refusing to seed non-local database host "${host}".`);
  process.exit(1);
}

const PASSWORD = "Password@123";
const DOMAIN = "@bookit.local";
const TZ = "Asia/Kolkata";
const DAY = 86_400_000;
const HOUR = 3_600_000;
const PAST_DAYS = 120;
const FUTURE_DAYS = 21;

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

let state = 20260928;
/** Mulberry32: a small seeded PRNG so every run makes the same data. */
function random() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
const chance = (p: number) => random() < p;
const shuffle = <T>(items: T[]) => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
};

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const CITIES = [
  { city: "Bengaluru", lat: 12.9716, lng: 77.5946, areas: ["Indiranagar", "Koramangala", "HSR Layout", "Whitefield"] },
  { city: "Chennai", lat: 13.0827, lng: 80.2707, areas: ["Anna Nagar", "Adyar", "Velachery"] },
  { city: "Mumbai", lat: 19.076, lng: 72.8777, areas: ["Andheri West", "Bandra", "Powai"] },
  { city: "Delhi", lat: 28.6139, lng: 77.209, areas: ["Saket", "Dwarka", "Rohini"] },
  { city: "Hyderabad", lat: 17.385, lng: 78.4867, areas: ["Gachibowli", "Madhapur", "Kondapur"] },
  { city: "Pune", lat: 18.5204, lng: 73.8567, areas: ["Baner", "Kothrud", "Viman Nagar"] },
  { city: "Kolkata", lat: 22.5726, lng: 88.3639, areas: ["Salt Lake", "Park Street", "New Town"] },
  { city: "Coimbatore", lat: 11.0168, lng: 76.9558, areas: ["RS Puram", "Peelamedu"] },
] as const;

const KINDS = [
  {
    sport: "Football",
    also: ["Cricket"],
    names: ["Turf Park", "Kickoff Arena", "Goal Line Turf", "The Pitch"],
    description: "5-a-side and 7-a-side FIFA-grade artificial turf with floodlights for night games.",
    amenities: ["Parking", "Floodlights", "Changing rooms", "Drinking water", "Washrooms"],
    rules: "No metal studs. Please arrive 10 minutes before your slot.",
    price: [1000, 1800],
  },
  {
    sport: "Badminton",
    also: ["Table Tennis"],
    names: ["Shuttle Hub", "Smash Arena", "Feather Courts"],
    description: "Wooden BWF-standard courts with good lighting; rackets and shuttles on request.",
    amenities: ["Air conditioning", "Equipment rental", "Washrooms", "Parking"],
    rules: "Non-marking shoes only.",
    price: [400, 700],
  },
  {
    sport: "Cricket",
    also: [],
    names: ["Box Cricket Club", "Boundary Nets", "Crease Arena"],
    description: "Box cricket and practice nets with a bowling machine.",
    amenities: ["Floodlights", "Equipment rental", "Seating area", "Parking"],
    rules: "Helmets are mandatory in the nets.",
    price: [800, 1500],
  },
  {
    sport: "Tennis",
    also: [],
    names: ["Baseline Tennis Centre", "Ace Courts"],
    description: "Hard courts with coaching available on weekday mornings.",
    amenities: ["Parking", "Floodlights", "Washrooms", "Cafe"],
    rules: "Tennis shoes only. Coaching sessions have priority 6-8 am on weekdays.",
    price: [600, 1000],
  },
  {
    sport: "Pickleball",
    also: ["Badminton"],
    names: ["Dink Club", "Kitchen Line Pickleball"],
    description: "Dedicated outdoor pickleball courts; paddles and balls included.",
    amenities: ["Equipment rental", "Drinking water", "Seating area"],
    rules: "Please book at least 2 players per court.",
    price: [500, 800],
  },
] as const;

const FIRST = ["Aarav", "Vivaan", "Aditya", "Ishaan", "Arjun", "Sai", "Reyansh", "Kabir", "Anaya", "Diya", "Saanvi", "Aadhya", "Kiara", "Myra", "Priya", "Neha", "Rahul", "Rohan", "Karthik", "Meera", "Lakshmi", "Farhan", "Zoya", "Imran", "Joseph", "Anjali", "Deepak", "Sneha", "Vikram", "Pooja"];
const LAST = ["Sharma", "Iyer", "Reddy", "Nair", "Patel", "Gupta", "Khan", "Menon", "Das", "Singh", "Rao", "Kulkarni", "Banerjee", "Fernandes", "Chopra"];

const REVIEWS: Record<number, string[]> = {
  5: ["Excellent surface and lights, will book again.", "Staff were super helpful and the court was spotless.", "Best turf in the area. Easy parking too.", "Great experience, everything as described."],
  4: ["Good venue, slightly crowded on weekends.", "Nice courts. Washrooms could be cleaner.", "Solid place for an evening game.", "Good value for the price."],
  3: ["Decent, but the lights flickered for a bit.", "Okay experience. Started 10 minutes late.", "Average. The turf is getting worn in places."],
  2: ["Booking was confirmed late and the court wasn't ready.", "Too expensive for what you get."],
  1: ["Venue was closed when we arrived even though it was confirmed."],
};

const POLICIES = [
  null,
  [{ hoursBefore: 24, refundPercent: 100 }, { hoursBefore: 6, refundPercent: 50 }],
  [{ hoursBefore: 48, refundPercent: 100 }, { hoursBefore: 12, refundPercent: 25 }],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const todayKey = localParts(new Date(), TZ).dateKey;
const at = (dayOffset: number, hour: number) =>
  zonedTimeToUtc(addDaysToKey(todayKey, dayOffset), `${String(hour).padStart(2, "0")}:00`, TZ);

/** Removes every @bookit.local account and everything that hangs off it. */
async function removeDemoData() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return;

  const venues = await prisma.venue.findMany({ where: { ownerId: { in: userIds } }, select: { id: true } });
  const venueIds = venues.map((v) => v.id);
  const bookingScope = { OR: [{ venueId: { in: venueIds } }, { userId: { in: userIds } }] };

  // In order, so foreign keys are satisfied (demo data, so no transaction needed).
  await prisma.review.deleteMany({ where: { OR: [{ venueId: { in: venueIds } }, { userId: { in: userIds } }] } });
  await prisma.booking.updateMany({ where: bookingScope, data: { rescheduledFromId: null } });
  await prisma.booking.deleteMany({ where: bookingScope });
  await prisma.coupon.deleteMany({ where: { OR: [{ createdById: { in: userIds } }, { venueId: { in: venueIds } }] } });
  await prisma.recurringBooking.deleteMany({ where: { OR: [{ venueId: { in: venueIds } }, { userId: { in: userIds } }] } });
  await prisma.timeSlot.deleteMany({ where: { venueId: { in: venueIds } } });
  await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }] } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  await removeDemoData();

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const account = (email: string, name: string, role: "USER" | "PROVIDER" | "ADMIN", createdAt: Date, extra: Partial<Prisma.UserCreateInput> = {}) =>
    prisma.user.create({ data: { email, name, role, passwordHash, emailVerifiedAt: createdAt, createdAt, ...extra } });

  const admin = await account(`admin${DOMAIN}`, "Asha Admin", "ADMIN", new Date(Date.now() - 200 * DAY));

  // Providers: the first is the easy-to-remember demo login.
  const providerNames = ["Priya Provider", "Ravi Venkatesh", "Sunita Arenas", "Mohan Sports", "Farah Courts", "Nikhil Grounds"];
  const providers = [];
  for (const [i, name] of providerNames.entries()) {
    providers.push(
      await account(i === 0 ? `provider${DOMAIN}` : `provider${i + 1}${DOMAIN}`, name, "PROVIDER", new Date(Date.now() - (190 - i * 10) * DAY), { phone: `98${String(40000000 + i * 1234567).slice(0, 8)}` })
    );
  }

  // Customers sign up steadily over the last six months (for retention cohorts).
  const customers = [];
  const customerCount = 80;
  for (let i = 0; i < customerCount; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const email = i === 0 ? `customer${DOMAIN}` : i === 1 ? `customer2${DOMAIN}` : `${name.toLowerCase().replace(/\s+/g, ".")}.${i}${DOMAIN}`;
    const joinedDaysAgo = i < 2 ? 170 : Math.round(((customerCount - i) / customerCount) * 175);
    customers.push(await account(email, i === 0 ? "Chris Customer" : i === 1 ? "Sam Second" : name, "USER", new Date(Date.now() - joinedDaysAgo * DAY - int(0, 20) * HOUR)));
  }
  // One suspended account for the admin pages.
  await prisma.user.update({
    where: { id: customers[customerCount - 3]!.id },
    data: { status: "SUSPENDED", statusReason: "Repeated no-shows", statusChangedAt: new Date(Date.now() - 3 * DAY) },
  });

  // Venues: four per provider, spread over the cities.
  const venues = [];
  let n = 0;
  for (const provider of providers) {
    for (let j = 0; j < 4; j++, n++) {
      const place = CITIES[n % CITIES.length]!;
      const kind = KINDS[(n * 3 + j) % KINDS.length]!;
      const area = pick(place.areas);
      const price = Math.round(int(kind.price[0], kind.price[1]) / 50) * 50;
      const opens = pick([5, 6, 6, 7]);
      const closes = pick([22, 23, 23]);
      const hours = Object.fromEntries(
        ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: `${String(opens).padStart(2, "0")}:00`, close: `${closes}:00` }])
      );

      const venue = await prisma.venue.create({
        data: {
          name: `${pick(kind.names)} ${area}`,
          description: kind.description,
          category: kind.sport,
          sportTypes: [kind.sport, ...kind.also],
          amenities: shuffle([...kind.amenities]).slice(0, int(3, kind.amenities.length)),
          rules: kind.rules,
          address: `${int(1, 250)}, ${area} Main Road`,
          city: place.city,
          latitude: place.lat + (random() - 0.5) * 0.12,
          longitude: place.lng + (random() - 0.5) * 0.12,
          openingHours: hours,
          pricePerHour: price,
          slotMinutes: kind.sport === "Football" || kind.sport === "Cricket" ? 60 : pick([30, 60]),
          maxBookingMinutes: 240,
          pendingHoldMinutes: pick([180, 720, 1440]),
          cancellationPolicy: pick(POLICIES) ?? undefined,
          ownerId: provider.id,
          createdAt: new Date(provider.createdAt.getTime() + int(1, 20) * DAY),
          slotTemplates: {
            create: { name: "Every day", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: `${String(opens).padStart(2, "0")}:00`, endTime: `${closes}:00` },
          },
          pricingRules: {
            create: [
              { name: "Evening peak", startTime: "18:00", endTime: `${closes}:00`, type: "MULTIPLIER", value: 1.25, priority: 1 },
              { name: "Weekend", daysOfWeek: [0, 6], startTime: `${String(opens).padStart(2, "0")}:00`, endTime: `${closes}:00`, type: "MULTIPLIER", value: 1.4, priority: 2 },
            ],
          },
        },
        include: { pricingRules: true, slotTemplates: true },
      });
      venues.push({ ...venue, opens, closes });
    }
  }

  // Opening windows for the whole period (past ones feed the occupancy reports).
  const slots: Prisma.TimeSlotCreateManyInput[] = [];
  for (const venue of venues) {
    for (let day = -PAST_DAYS; day <= 30; day++) {
      slots.push({ venueId: venue.id, templateId: venue.slotTemplates[0]!.id, startTime: at(day, venue.opens), endTime: at(day, venue.closes) });
    }
  }
  await prisma.timeSlot.createMany({ data: slots });

  // Coupons.
  const coupons = await Promise.all([
    prisma.coupon.create({ data: { code: "WELCOME100", description: "₹100 off your first booking", type: "FLAT", value: 100, perUserLimit: 1, createdById: admin.id } }),
    prisma.coupon.create({ data: { code: "WEEKDAY20", description: "20% off (max ₹200)", type: "PERCENT", value: 20, maxDiscount: 200, minAmount: 500, createdById: admin.id } }),
    prisma.coupon.create({ data: { code: "MONSOON15", description: "Monsoon offer, ended", type: "PERCENT", value: 15, validTo: new Date(Date.now() - 10 * DAY), createdById: admin.id } }),
  ]);

  // Bookings: busier evenings and weekends, growing over time.
  const bookings: Prisma.BookingCreateManyInput[] = [];
  const now = Date.now();
  for (const venue of venues) {
    const rules = venue.pricingRules.map(toPriceRule);
    const popularity = 0.6 + random() * 0.9;

    for (let day = -PAST_DAYS; day <= FUTURE_DAYS; day++) {
      if (at(day, 0).getTime() < venue.createdAt.getTime()) continue;
      const weekday = localParts(at(day, 12), TZ).weekday;
      const weekend = weekday === 0 || weekday === 6;
      const growth = 0.6 + 0.4 * ((day + PAST_DAYS) / (PAST_DAYS + FUTURE_DAYS));
      const wanted = Math.round((weekend ? 5 : 3) * popularity * growth * (day > 7 ? 0.4 : 1) + (random() - 0.5) * 2);

      const hours = shuffle(Array.from({ length: venue.closes - venue.opens }, (_, i) => venue.opens + i))
        // Evenings first most of the time.
        .sort((a, b) => (b >= 17 ? 1 : 0) - (a >= 17 ? 1 : 0) + (random() - 0.5));
      const taken = new Set<number>();

      for (const hour of hours) {
        if (taken.size >= wanted) break;
        const length = chance(0.25) && hour + 2 <= venue.closes ? 2 : 1;
        if (taken.has(hour) || (length === 2 && taken.has(hour + 1))) continue;
        for (let h = hour; h < hour + length; h++) taken.add(h);

        const startTime = at(day, hour);
        const endTime = at(day, hour + length);
        const past = endTime.getTime() < now;
        const walkIn = chance(0.08);
        const customer = pick(customers.filter((c) => c.createdAt.getTime() < startTime.getTime() - DAY)) ?? customers[0]!;
        const createdAt = new Date(Math.max(customer.createdAt.getTime(), startTime.getTime() - int(2, 240) * HOUR, venue.createdAt.getTime()));
        if (createdAt.getTime() > now) continue;

        const price = calculatePrice(Number(venue.pricePerHour), rules, startTime, endTime, TZ);
        const roll = random();
        let status: Prisma.BookingCreateManyInput["status"];
        if (walkIn) status = past ? "COMPLETED" : "CONFIRMED";
        else if (past) status = roll < 0.78 ? "COMPLETED" : roll < 0.9 ? "CANCELLED" : "EXPIRED";
        else status = roll < 0.65 ? "CONFIRMED" : roll < 0.93 ? "PENDING" : "CANCELLED";

        const coupon = !walkIn && chance(0.06) ? (createdAt.getTime() < now - 12 * DAY ? coupons[2] : coupons[1]) : null;
        const discount = coupon ? Math.min(Math.round(price.total * (coupon.type === "PERCENT" ? Number(coupon.value) / 100 : 0)), coupon.maxDiscount ? Number(coupon.maxDiscount) : Infinity) : 0;
        const cancelled = status === "CANCELLED";

        bookings.push({
          userId: walkIn ? venue.ownerId : customer.id,
          venueId: venue.id,
          startTime,
          endTime,
          status,
          source: walkIn ? "WALK_IN" : "ONLINE",
          guestName: walkIn ? `${pick(FIRST)} (walk-in)` : null,
          bookingCode: newBookingCode(),
          totalPrice: price.total - discount,
          priceBreakdown: price.breakdown as unknown as Prisma.InputJsonValue,
          couponId: discount > 0 ? coupon!.id : null,
          discountAmount: discount > 0 ? discount : null,
          expiresAt: status === "PENDING" ? new Date(Math.min(now + int(2, 20) * HOUR, startTime.getTime())) : null,
          checkedInAt: status === "COMPLETED" && chance(0.6) ? new Date(startTime.getTime() - int(5, 20) * 60_000) : null,
          noShow: status === "COMPLETED" && chance(0.03),
          cancelledAt: cancelled ? new Date(Math.min(startTime.getTime() - HOUR, createdAt.getTime() + int(1, 48) * HOUR)) : null,
          cancelledById: cancelled ? customer.id : null,
          refundPercent: cancelled ? pick([100, 100, 50]) : null,
          reminder24hSentAt: past ? startTime : null,
          reminder2hSentAt: past ? startTime : null,
          createdAt,
        });
      }
    }
  }

  await prisma.booking.createMany({ data: bookings });

  // Reviews on about 40% of completed online bookings.
  const completed = await prisma.booking.findMany({
    where: { status: "COMPLETED", source: "ONLINE", venueId: { in: venues.map((v) => v.id) } },
    select: { id: true, userId: true, venueId: true, endTime: true },
  });
  const venueQuality = new Map(venues.map((v) => [v.id, 3.4 + random() * 1.5]));
  const reviews: Prisma.ReviewCreateManyInput[] = [];
  for (const booking of completed) {
    if (!chance(0.4)) continue;
    const rating = Math.max(1, Math.min(5, Math.round(venueQuality.get(booking.venueId)! + (random() - 0.5) * 2)));
    const createdAt = new Date(booking.endTime.getTime() + int(1, 72) * HOUR);
    const replied = chance(0.25);
    reviews.push({
      userId: booking.userId,
      venueId: booking.venueId,
      bookingId: booking.id,
      rating,
      review: chance(0.8) ? pick(REVIEWS[rating]!) : null,
      providerReply: replied ? "Thanks for playing with us - see you again soon!" : null,
      providerRepliedAt: replied ? new Date(Math.min(now, createdAt.getTime() + DAY)) : null,
      createdAt: createdAt.getTime() > now ? new Date(now) : createdAt,
    });
  }
  await prisma.review.createMany({ data: reviews });

  // One reported review waiting for moderation.
  const harsh = await prisma.review.findFirst({ where: { venueId: { in: venues.map((v) => v.id) }, rating: { lte: 2 } } });
  if (harsh) {
    await prisma.reviewReport.create({ data: { reviewId: harsh.id, reporterId: customers[5]!.id, reason: "Looks like it's from a competitor" } });
    await prisma.review.update({ where: { id: harsh.id }, data: { status: "FLAGGED" } });
  }

  for (const venue of venues) await refreshVenueRating(venue.id);

  // Approval queue: one new listing waiting, one sent back.
  const newest = venues.at(-1)!;
  await prisma.venue.update({ where: { id: newest.id }, data: { approvalStatus: "PENDING", createdAt: new Date(now - 2 * DAY) } });
  const secondNewest = venues.at(-2)!;
  await prisma.venue.update({
    where: { id: secondNewest.id },
    data: { approvalStatus: "REJECTED", rejectionReason: "Please add photos of the courts and the full address", reviewedAt: new Date(now - DAY) },
  });

  // Favourites for the demo customer.
  await prisma.favorite.createMany({ data: venues.slice(0, 3).map((v) => ({ userId: customers[0]!.id, venueId: v.id })) });

  console.log(
    `Seeded ${providers.length} providers, ${customers.length} customers, ${venues.length} venues, ${slots.length} opening windows, ` +
      `${bookings.length} bookings and ${reviews.length} reviews in ${((Date.now() - started) / 1000).toFixed(1)} s.`
  );
  console.log(`Log in with any of these (password: ${PASSWORD}):`);
  for (const email of [`admin${DOMAIN}`, `provider${DOMAIN}`, `customer${DOMAIN}`, `customer2${DOMAIN}`]) {
    console.log(`  ${email}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
