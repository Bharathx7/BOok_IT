import { jest } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

jest.unstable_mockModule("../src/services/email.service.js", () => ({
  queueEmail: jest.fn(() => Promise.resolve()),
  sendVerificationEmail: jest.fn(() => Promise.resolve()),
  sendPasswordResetEmail: jest.fn(() => Promise.resolve()),
  sendPasswordChangedEmail: jest.fn(() => Promise.resolve()),
  sendTestEmail: jest.fn(() => Promise.resolve()),
}));

jest.unstable_mockModule("../src/sockets/socket.js", () => ({
  emitBookingEvent: jest.fn(),
  emitNotification: jest.fn(),
  initializeSocket: jest.fn(),
}));

const { default: request } = await import("supertest");
const { default: sharp } = await import("sharp");
const { default: app } = await import("../src/app.js");
const { default: prisma } = await import("../src/config/prisma.js");
const { generateAccessToken } = await import("../src/utils/jwt.js");
const { uploadsDir } = await import("../src/storage/index.js");
const { toPrefixQuery } = await import("../src/services/venueSearch.service.js");

jest.setTimeout(30000);

const HOUR = 60 * 60 * 1000;
const IST_OFFSET = 5.5 * HOUR;

/** YYYY-MM-DD of the IST day `days` from today. */
const istDate = (days: number) =>
  new Date(Date.now() + IST_OFFSET + days * 24 * HOUR).toISOString().slice(0, 10);

/** UTC instant of `hour`:00 IST on the given IST date. */
const istTime = (date: string, hour: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - IST_OFFSET + hour * HOUR);

const pngOf = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 3, background: { r: 13, g: 148, b: 136 } },
  })
    .png()
    .toBuffer();

describe("Venue discovery", () => {
  const u = `${Date.now()}`;
  // Unique city names keep these venues apart from other suites' data.
  const cityA = `Alphaville${u}`;
  const cityB = `Betatown${u}`;

  let ownerId: string;
  let otherOwnerId: string;
  let customerId: string;
  let ownerToken: string;
  let otherOwnerToken: string;
  let customerToken: string;
  let turfId: string;
  let courtId: string;
  let hiddenId: string;

  const search = (query: Record<string, string | number>, token?: string) => {
    const req = request(app).get("/api/venues").query(query);
    return token ? req.set("Authorization", `Bearer ${token}`) : req;
  };

  const namesOf = (response: { body: { venues: { name: string }[] } }) =>
    response.body.venues.map((venue) => venue.name).sort();

  beforeAll(async () => {
    const make = (label: string, role: "USER" | "PROVIDER") =>
      prisma.user.create({
        data: {
          name: `Discovery ${label}`,
          email: `discovery-${label}-${u}@example.com`,
          passwordHash: "x",
          role,
          emailVerifiedAt: new Date(),
        },
      });

    const owner = await make("owner", "PROVIDER");
    const otherOwner = await make("other-owner", "PROVIDER");
    const customer = await make("customer", "USER");
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;
    customerId = customer.id;
    ownerToken = generateAccessToken(owner);
    otherOwnerToken = generateAccessToken(otherOwner);
    customerToken = generateAccessToken(customer);

    const turf = await prisma.venue.create({
      data: {
        name: `Green Turf Arena ${u}`,
        description: "Floodlit five-a-side football turf",
        category: "Football",
        sportTypes: ["Football", "Cricket"],
        amenities: ["Parking", "Floodlights", "Showers"],
        city: cityA,
        latitude: 13.0827,
        longitude: 80.2707, // Chennai
        pricePerHour: 1200,
        avgRating: 4.6,
        reviewCount: 10,
        ownerId,
      },
    });
    const court = await prisma.venue.create({
      data: {
        name: `Shuttle Court ${u}`,
        description: "Indoor wooden badminton courts",
        category: "Badminton",
        sportTypes: ["Badminton"],
        amenities: ["Parking"],
        city: cityB,
        latitude: 12.9716,
        longitude: 77.5946, // Bengaluru, ~290 km away
        pricePerHour: 400,
        avgRating: 3.9,
        reviewCount: 4,
        ownerId,
      },
    });
    const hidden = await prisma.venue.create({
      data: {
        name: `Hidden Turf ${u}`,
        category: "Football",
        sportTypes: ["Football"],
        city: cityA,
        latitude: 13.08,
        longitude: 80.27,
        pricePerHour: 900,
        isActive: false,
        ownerId,
      },
    });
    turfId = turf.id;
    courtId = court.id;
    hiddenId = hidden.id;
  });

  afterAll(async () => {
    const venueIds = [turfId, courtId, hiddenId];
    await prisma.review.deleteMany({ where: { venueId: { in: venueIds } } });
    await prisma.booking.deleteMany({ where: { venueId: { in: venueIds } } });
    await prisma.timeSlot.deleteMany({ where: { venueId: { in: venueIds } } });
    await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId, customerId] } } });
    await rm(uploadsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await prisma.$disconnect();
  });

  describe("search filters", () => {
    it("matches words by prefix across name, description and city", async () => {
      expect(toPrefixQuery("5-a-side Turf!")).toBe("5:* & a:* & side:* & turf:*");

      const byPrefix = await search({ q: `turf ${u}` });
      expect(byPrefix.status).toBe(200);
      expect(namesOf(byPrefix)).toEqual([`Green Turf Arena ${u}`]);

      const byDescription = await search({ q: `badmin ${u}`.replace(` ${u}`, ""), city: cityB });
      expect(namesOf(byDescription)).toEqual([`Shuttle Court ${u}`]);

      const byCity = await search({ q: cityA.toLowerCase() });
      expect(namesOf(byCity)).toEqual([`Green Turf Arena ${u}`]);
    });

    it("never shows hidden venues", async () => {
      const response = await search({ city: cityA });
      expect(namesOf(response)).toEqual([`Green Turf Arena ${u}`]);
    });

    it("filters by sport (any of the venue's sports), city, price, rating and amenities", async () => {
      expect(namesOf(await search({ sport: "cricket", city: cityA }))).toEqual([`Green Turf Arena ${u}`]);
      expect(namesOf(await search({ sport: "Badminton", city: cityA }))).toEqual([]);
      expect(namesOf(await search({ city: cityB.toUpperCase() }))).toEqual([`Shuttle Court ${u}`]);

      const cheap = await search({ q: u, maxPrice: 500 });
      expect(namesOf(cheap)).toEqual([`Shuttle Court ${u}`]);

      const wellRated = await search({ q: u, minRating: 4.5 });
      expect(namesOf(wellRated)).toEqual([`Green Turf Arena ${u}`]);

      const withShowers = await search({ q: u, amenities: "Parking,Showers" });
      expect(namesOf(withShowers)).toEqual([`Green Turf Arena ${u}`]);
    });

    it("sorts by price and paginates", async () => {
      const ascending = await search({ q: u, sort: "price_asc" });
      expect(ascending.body.venues.map((v: { name: string }) => v.name)).toEqual([
        `Shuttle Court ${u}`,
        `Green Turf Arena ${u}`,
      ]);

      const firstPage = await search({ q: u, sort: "price_desc", limit: 1 });
      expect(firstPage.body.venues).toHaveLength(1);
      expect(firstPage.body.pagination).toMatchObject({ total: 2, totalPages: 2 });
    });

    it("finds venues near a point, nearest first, with the distance", async () => {
      // A point a few km from the Chennai turf.
      const near = await search({ lat: 13.05, lng: 80.25, radiusKm: 20, q: u });
      expect(namesOf(near)).toEqual([`Green Turf Arena ${u}`]);
      expect(near.body.venues[0].distanceKm).toBeGreaterThan(2);
      expect(near.body.venues[0].distanceKm).toBeLessThan(6);

      const wide = await search({ lat: 13.05, lng: 80.25, radiusKm: 100, q: u });
      expect(namesOf(wide)).toEqual([`Green Turf Arena ${u}`]);

      const withBangalore = await search({ lat: 13.05, lng: 80.25, radiusKm: 100, q: u, sort: "distance" });
      expect(withBangalore.body.venues).toHaveLength(1);
    });

    it("rejects invalid filters", async () => {
      expect((await search({ date: "03-10-2026" })).status).toBe(400);
      expect((await search({ lat: 13 })).status).toBe(400);
      expect((await search({ time: "18:00" })).status).toBe(400);
      expect((await search({ minPrice: 900, maxPrice: 100 })).status).toBe(400);
      expect((await search({ sort: "cheapest" })).status).toBe(400);
    });
  });

  describe("availability filter", () => {
    const day = istDate(3);

    beforeAll(async () => {
      // Open 06:00-23:00 IST; 18:00-20:00 already taken.
      await prisma.timeSlot.create({
        data: { venueId: turfId, startTime: istTime(day, 6), endTime: istTime(day, 23) },
      });
      await prisma.booking.create({
        data: {
          userId: customerId,
          venueId: turfId,
          startTime: istTime(day, 18),
          endTime: istTime(day, 20),
          status: "CONFIRMED",
        },
      });
    });

    it("checks a specific time in the venue's timezone", async () => {
      expect(namesOf(await search({ city: cityA, date: day, time: "17:00" }))).toEqual([
        `Green Turf Arena ${u}`,
      ]);
      // 17:00 for two hours runs into the 18:00 booking.
      expect(namesOf(await search({ city: cityA, date: day, time: "17:00", duration: 120 }))).toEqual([]);
      expect(namesOf(await search({ city: cityA, date: day, time: "18:30" }))).toEqual([]);
      expect(namesOf(await search({ city: cityA, date: day, time: "20:00" }))).toEqual([
        `Green Turf Arena ${u}`,
      ]);
      // Outside opening slots.
      expect(namesOf(await search({ city: cityA, date: day, time: "23:00" }))).toEqual([]);
    });

    it("a day with free time matches; a day without slots does not", async () => {
      expect(namesOf(await search({ city: cityA, date: day }))).toEqual([`Green Turf Arena ${u}`]);
      expect(namesOf(await search({ city: cityA, date: istDate(4) }))).toEqual([]);
    });

    it("a fully booked day does not match, but expired holds don't count", async () => {
      const fullDay = istDate(5);
      await prisma.timeSlot.create({
        data: { venueId: courtId, startTime: istTime(fullDay, 8), endTime: istTime(fullDay, 10) },
      });
      const hold = await prisma.booking.create({
        data: {
          userId: customerId,
          venueId: courtId,
          startTime: istTime(fullDay, 8),
          endTime: istTime(fullDay, 10),
          status: "PENDING",
          expiresAt: new Date(Date.now() + HOUR),
        },
      });

      expect(namesOf(await search({ city: cityB, date: fullDay }))).toEqual([]);

      await prisma.booking.update({
        where: { id: hold.id },
        data: { expiresAt: new Date(Date.now() - HOUR) },
      });
      expect(namesOf(await search({ city: cityB, date: fullDay }))).toEqual([`Shuttle Court ${u}`]);
    });
  });

  describe("venue page, favourites and ratings", () => {
    it("hides inactive venues from the public but not from their owner", async () => {
      expect((await request(app).get(`/api/venues/${hiddenId}`)).status).toBe(404);

      const asOwner = await request(app)
        .get(`/api/venues/${hiddenId}`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(asOwner.status).toBe(200);
      expect(asOwner.body.venue.isActive).toBe(false);
    });

    it("saves, lists and removes favourites, and flags them in search", async () => {
      const auth = { Authorization: `Bearer ${customerToken}` };

      expect((await request(app).post(`/api/venues/${turfId}/favorite`).set(auth)).status).toBe(204);
      // Saving twice is fine.
      expect((await request(app).post(`/api/venues/${turfId}/favorite`).set(auth)).status).toBe(204);
      expect((await request(app).post(`/api/venues/${hiddenId}/favorite`).set(auth)).status).toBe(404);

      const favorites = await request(app).get("/api/users/me/favorites").set(auth);
      expect(favorites.body.venues.map((v: { id: string }) => v.id)).toEqual([turfId]);

      const flagged = await search({ q: u }, customerToken);
      const flags = Object.fromEntries(
        flagged.body.venues.map((v: { id: string; isFavorite: boolean }) => [v.id, v.isFavorite])
      );
      expect(flags).toEqual({ [turfId]: true, [courtId]: false });

      const details = await request(app).get(`/api/venues/${turfId}`).set(auth);
      expect(details.body.venue.isFavorite).toBe(true);

      expect((await request(app).delete(`/api/venues/${turfId}/favorite`).set(auth)).status).toBe(204);
      expect((await request(app).get("/api/users/me/favorites").set(auth)).body.venues).toEqual([]);
    });

    it("keeps the stored rating in sync when a review is added", async () => {
      const booking = await prisma.booking.create({
        data: {
          userId: customerId,
          venueId: courtId,
          startTime: new Date(Date.now() - 5 * HOUR),
          endTime: new Date(Date.now() - 4 * HOUR),
          status: "COMPLETED",
        },
      });

      const review = await request(app)
        .post("/api/reviews")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ bookingId: booking.id, rating: 2, review: "Okay" });
      expect(review.status).toBe(201);

      // The only real review now defines the average.
      const venue = await prisma.venue.findUnique({ where: { id: courtId } });
      expect(venue?.avgRating).toBe(2);
      expect(venue?.reviewCount).toBe(1);

      const reviews = await request(app).get(`/api/venues/${courtId}/reviews`);
      expect(reviews.body.reviews).toHaveLength(1);
      expect(reviews.body.reviews[0].user.name).toBe("Discovery customer");
    });
  });

  describe("photos", () => {
    const upload = (token: string, files: { buffer: Buffer; name: string; type?: string }[]) => {
      let req = request(app)
        .post(`/api/venues/${turfId}/images`)
        .set("Authorization", `Bearer ${token}`);
      for (const file of files) {
        req = req.attach("images", file.buffer, {
          filename: file.name,
          contentType: file.type ?? "image/png",
        });
      }
      return req;
    };

    it("stores resized WebP copies, sets a cover, reorders and deletes", async () => {
      const big = await pngOf(3000, 2000);
      const small = await pngOf(400, 300);

      const response = await upload(ownerToken, [
        { buffer: big, name: "big.png" },
        { buffer: small, name: "small.png" },
      ]);

      expect(response.status).toBe(201);
      const [first, second] = response.body.images;
      expect(first.isCover).toBe(true);
      expect(second.isCover).toBe(false);
      // Downscaled to fit 1600 px, aspect ratio kept; small ones untouched.
      expect([first.width, first.height]).toEqual([1600, 1067]);
      expect([second.width, second.height]).toEqual([400, 300]);
      expect(first.url).toMatch(/^\/api\/uploads\/venues\/.+\.webp$/);

      const stored = path.join(uploadsDir, first.storageKey);
      expect(existsSync(stored)).toBe(true);
      // Read into memory: sharp keeps files it opens by path locked on Windows.
      expect((await sharp(readFileSync(stored)).metadata()).format).toBe("webp");

      // Served to the browser.
      const served = await request(app).get(first.url);
      expect(served.status).toBe(200);

      const summary = await search({ q: `arena ${u}` });
      expect(summary.body.venues[0].coverImageUrl).toBe(first.url);

      const cover = await request(app)
        .put(`/api/venues/${turfId}/images/${second.id}/cover`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(cover.body.images.find((i: { isCover: boolean }) => i.isCover).id).toBe(second.id);

      const reordered = await request(app)
        .put(`/api/venues/${turfId}/images/order`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ imageIds: [second.id, first.id] });
      expect(reordered.body.images.map((i: { id: string }) => i.id)).toEqual([second.id, first.id]);

      const removed = await request(app)
        .delete(`/api/venues/${turfId}/images/${second.id}`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(removed.body.images).toHaveLength(1);
      // The remaining photo becomes the cover.
      expect(removed.body.images[0]).toMatchObject({ id: first.id, isCover: true });
      expect(existsSync(path.join(uploadsDir, second.storageKey))).toBe(false);
    });

    it("rejects files that aren't really images, and other owners", async () => {
      const fake = await upload(ownerToken, [
        { buffer: Buffer.from("definitely not a png"), name: "fake.png" },
      ]);
      expect(fake.status).toBe(400);
      expect(fake.body.message).toMatch(/not a valid/i);

      const pdf = await upload(ownerToken, [
        { buffer: Buffer.from("%PDF-1.4"), name: "doc.pdf", type: "application/pdf" },
      ]);
      expect(pdf.status).toBe(400);

      const stranger = await upload(otherOwnerToken, [{ buffer: await pngOf(50, 50), name: "a.png" }]);
      expect(stranger.status).toBe(403);

      const customer = await upload(customerToken, [{ buffer: await pngOf(50, 50), name: "a.png" }]);
      expect(customer.status).toBe(403);
    });

    it("limits a venue to 10 photos", async () => {
      const image = await pngOf(40, 40);
      const files = Array.from({ length: 10 }, (_, i) => ({ buffer: image, name: `p${i}.png` }));

      const response = await upload(ownerToken, files);

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/at most 10 photos/i);
    });
  });
});
