// Index review helper (Phase 7): runs the app's busiest read paths against the
// local seeded database with Postgres auto_explain switched on, so every
// query's real plan lands in the database log.
//
//   npm run db:seed
//   npx tsx scripts/explain-hot-queries.ts
//   docker logs bookit-postgres --since 2m 2>&1 | less
//
// Local databases only; auto_explain is switched off again at the end.
import prisma from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { getAdminBookings, getAdminUsers, getAdminVenues, adminSearch, getPlatformAnalytics } from "../src/services/admin.service.js";
import { getProviderBookings, getUserBookings } from "../src/services/booking.service.js";
import { listNotifications } from "../src/services/notification.service.js";
import { getProviderAnalytics } from "../src/services/providerAnalytics.service.js";
import { getVenueById, getVenueReviews, searchVenues } from "../src/services/venue.service.js";
import { getDaySchedule } from "../src/services/venueTools.service.js";
import { addDaysToKey, localParts } from "../src/utils/datetime.js";

const host = new URL(env.DATABASE_URL).hostname;
if (!["localhost", "127.0.0.1"].includes(host)) {
  console.error(`Refusing to run against non-local database host "${host}".`);
  process.exit(1);
}

const page = { page: 1, limit: 20, skip: 0 };
const today = localParts(new Date(), "Asia/Kolkata").dateKey;

async function timed(label: string, run: () => Promise<unknown>) {
  const started = performance.now();
  await run();
  console.log(`${label.padEnd(42)} ${(performance.now() - started).toFixed(0).padStart(5)} ms`);
}

async function main() {
  const db = (await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`)[0]!.db;
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" SET session_preload_libraries = 'auto_explain'`);
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" SET auto_explain.log_min_duration = 0`);
  await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" SET auto_explain.log_analyze = on`);
  // Settings apply to new sessions only.
  await prisma.$disconnect();

  try {
    const venue = await prisma.venue.findFirstOrThrow({ where: { approvalStatus: "APPROVED" }, orderBy: { reviewCount: "desc" } });
    const provider = await prisma.user.findFirstOrThrow({ where: { email: "provider@bookit.local" } });
    const customer = await prisma.user.findFirstOrThrow({ where: { email: "customer@bookit.local" } });

    await timed("search: default (recommended)", () => searchVenues({}, page));
    await timed("search: text", () => searchVenues({ q: "turf" }, page));
    await timed("search: city + sport + max price", () => searchVenues({ city: "Bengaluru", sport: "Football", maxPrice: 1500 }, page));
    await timed("search: free on date at 18:00", () => searchVenues({ date: addDaysToKey(today, 2), time: "18:00", duration: 60 }, page));
    await timed("search: free some time on date", () => searchVenues({ date: addDaysToKey(today, 2) }, page));
    await timed("search: near me", () => searchVenues({ lat: 12.97, lng: 77.59, radiusKm: 15 }, page));
    await timed("search: popular", () => searchVenues({ sort: "popular" }, page));
    await timed("venue page", () => getVenueById(venue.id));
    await timed("venue reviews", () => getVenueReviews(venue.id, page));
    await timed("day schedule", () => getDaySchedule(venue.id, addDaysToKey(today, 1)));
    await timed("customer bookings", () => getUserBookings(customer.id, page));
    await timed("provider bookings", () => getProviderBookings(provider.id, page));
    await timed("notifications", () => listNotifications(customer.id, page));
    await timed("provider analytics 90 days", () => getProviderAnalytics(provider.id, { from: addDaysToKey(today, -89), to: today }));
    await timed("admin: platform analytics 90 days", () => getPlatformAnalytics({ from: addDaysToKey(today, -89), to: today }));
    await timed("admin: bookings (search by email)", () => getAdminBookings(page, { q: "customer@bookit" }));
    await timed("admin: users", () => getAdminUsers(page, { q: "sharma" }));
    await timed("admin: approval queue", () => getAdminVenues(page, { approvalStatus: "PENDING" }));
    await timed("admin: search", () => adminSearch("chennai"));
  } finally {
    await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" RESET session_preload_libraries`);
    await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" RESET auto_explain.log_min_duration`);
    await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" RESET auto_explain.log_analyze`);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
