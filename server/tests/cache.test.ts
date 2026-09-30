import request from "supertest";
import app from "../src/app.js";
import prisma from "../src/config/prisma.js";
import { cached, cacheStats, clearCache, invalidate } from "../src/utils/cache.js";
import { generateAccessToken } from "../src/utils/jwt.js";

describe("cache", () => {
  beforeEach(() => clearCache());

  it("loads once, shares concurrent loads and expires", async () => {
    let loads = 0;
    const load = async () => {
      loads++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return loads;
    };

    const [a, b] = await Promise.all([cached("k", 50, load), cached("k", 50, load)]);
    expect([a, b, loads]).toEqual([1, 1, 1]);
    expect(await cached("k", 50, load)).toBe(1);
    expect(cacheStats()).toMatchObject({ hits: 1 });

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(await cached("k", 50, load)).toBe(2);
  });

  it("drops keys by prefix, including a load still in flight", async () => {
    await cached("venue:1", 10_000, async () => "old");
    await cached("venue:2", 10_000, async () => "two");
    invalidate("venue:1");
    expect(await cached("venue:1", 10_000, async () => "new")).toBe("new");
    expect(await cached("venue:2", 10_000, async () => "changed")).toBe("two");

    let release!: (value: string) => void;
    const slow = cached("venue:3", 10_000, () => new Promise<string>((resolve) => (release = resolve)));
    invalidate("venue:");
    release("stale");
    expect(await slow).toBe("stale");
    // The stale result wasn't kept.
    expect(await cached("venue:3", 10_000, async () => "fresh")).toBe("fresh");
  });
});

describe("cached venue pages", () => {
  const u = `${Date.now()}`;
  let venueId: string;
  let auth: { Authorization: string };
  let ownerId: string;

  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: { name: "Cache Owner", email: `cache-${u}@example.com`, passwordHash: "x", role: "PROVIDER", emailVerifiedAt: new Date() },
    });
    ownerId = owner.id;
    auth = { Authorization: `Bearer ${generateAccessToken(owner)}` };
    venueId = (await prisma.venue.create({ data: { name: `Cached ${u}`, ownerId: owner.id } })).id;
  });

  afterAll(async () => {
    await prisma.venue.deleteMany({ where: { id: venueId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
  });

  it("shows changes made through the API straight away", async () => {
    expect((await request(app).get(`/api/v1/venues/${venueId}`)).body.venue.name).toBe(`Cached ${u}`);
    await request(app).put(`/api/v1/venues/${venueId}`).set(auth).send({ name: `Renamed ${u}` });
    expect((await request(app).get(`/api/v1/venues/${venueId}`)).body.venue.name).toBe(`Renamed ${u}`);

    // Hiding it takes effect at once for customers, while the owner still sees it.
    await request(app).put(`/api/v1/venues/${venueId}`).set(auth).send({ isActive: false });
    expect((await request(app).get(`/api/v1/venues/${venueId}`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/venues/${venueId}`).set(auth)).status).toBe(200);
  });
});
