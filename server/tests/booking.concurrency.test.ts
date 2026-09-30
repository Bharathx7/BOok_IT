import { jest } from "@jest/globals";

jest.unstable_mockModule("../src/sockets/socket.js", () => ({
  emitNotification: jest.fn(),
  emitBookingEvent: jest.fn(),
  initializeSocket: jest.fn(),
}));

jest.unstable_mockModule("../src/services/email.service.js", () => ({
  queueEmail: jest.fn(() => Promise.resolve()),
  sendBookingConfirmationEmail: jest.fn(() => Promise.resolve()),
  sendBookingCancellationEmail: jest.fn(() => Promise.resolve()),
  sendBookingReminderEmail: jest.fn(() => Promise.resolve()),
  sendTestEmail: jest.fn(() => Promise.resolve()),
  sendVerificationEmail: jest.fn(() => Promise.resolve()),
  sendPasswordResetEmail: jest.fn(() => Promise.resolve()),
  sendPasswordChangedEmail: jest.fn(() => Promise.resolve()),
}));

const { default: request } = await import("supertest");
const { default: app } = await import("../src/app.js");
const { default: prisma } = await import("../src/config/prisma.js");
const { generateAccessToken } = await import("../src/utils/jwt.js");
const { isExclusionViolation } = await import("../src/utils/dbErrors.js");

jest.setTimeout(30000);

const HOUR = 60 * 60 * 1000;
const CONCURRENT_REQUESTS = 6;

describe("Double booking protection", () => {
  const unique = Date.now();

  let ownerId: string;
  let venueId: string;
  const customerIds: string[] = [];
  const customerTokens: string[] = [];

  // A day far enough ahead that "cannot book in the past" never interferes.
  const dayStart = new Date(Date.now() + 10 * 24 * HOUR);
  dayStart.setUTCHours(0, 0, 0, 0);
  const at = (hours: number) => new Date(dayStart.getTime() + hours * HOUR);

  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: {
        name: "Concurrency Owner",
        email: `concurrency-owner-${unique}@example.com`,
        passwordHash: "test-password-hash",
        role: "PROVIDER",
        emailVerifiedAt: new Date(),
      },
    });
    ownerId = owner.id;

    for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
      const customer = await prisma.user.create({
        data: {
          name: `Concurrency Customer ${i}`,
          email: `concurrency-customer-${i}-${unique}@example.com`,
          passwordHash: "test-password-hash",
          role: "USER",
          emailVerifiedAt: new Date(),
        },
      });
      customerIds.push(customer.id);
      customerTokens.push(
        generateAccessToken({
          id: customer.id,
          email: customer.email,
          role: customer.role,
        })
      );
    }

    const venue = await prisma.venue.create({
      data: {
        name: `Concurrency Venue ${unique}`,
        description: "Venue created for concurrency tests",
        address: "Test Address",
        pricePerHour: 100,
        ownerId,
      },
    });
    venueId = venue.id;

    await prisma.timeSlot.create({
      data: {
        venueId,
        startTime: at(6),
        endTime: at(23),
      },
    });
  });

  afterEach(async () => {
    await prisma.booking.deleteMany({ where: { venueId } });
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { venueId } });
    await prisma.timeSlot.deleteMany({ where: { venueId } });
    await prisma.venue.deleteMany({ where: { id: venueId } });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, ...customerIds] } },
    });
    await prisma.$disconnect();
  });

  it("lets exactly one of several simultaneous requests book the same slot", async () => {
    const responses = await Promise.all(
      customerTokens.map((token) =>
        request(app)
          .post("/api/bookings")
          .set("Authorization", `Bearer ${token}`)
          .send({
            venueId,
            startTime: at(18).toISOString(),
            endTime: at(19).toISOString(),
          })
      )
    );

    const statuses = responses.map((response) => response.status);

    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(
      CONCURRENT_REQUESTS - 1
    );

    for (const response of responses.filter((r) => r.status === 409)) {
      expect(response.body.message).toBe("This time is already booked");
    }

    const activeBookings = await prisma.booking.count({
      where: { venueId, status: { in: ["PENDING", "CONFIRMED"] } },
    });
    expect(activeBookings).toBe(1);
  });

  it("rejects partially overlapping simultaneous requests", async () => {
    // 18:00-20:00 and 19:00-21:00 overlap by an hour.
    const [first, second] = await Promise.all([
      request(app)
        .post("/api/bookings")
        .set("Authorization", `Bearer ${customerTokens[0]}`)
        .send({
          venueId,
          startTime: at(18).toISOString(),
          endTime: at(20).toISOString(),
        }),
      request(app)
        .post("/api/bookings")
        .set("Authorization", `Bearer ${customerTokens[1]}`)
        .send({
          venueId,
          startTime: at(19).toISOString(),
          endTime: at(21).toISOString(),
        }),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
  });

  describe("database exclusion constraint", () => {
    // These go straight to Prisma, skipping the service's overlap check, to
    // prove the database itself enforces the rule.
    const insertBooking = (
      userId: string,
      startHour: number,
      endHour: number,
      status: "PENDING" | "CONFIRMED" | "CANCELLED" = "PENDING"
    ) =>
      prisma.booking.create({
        data: {
          userId,
          venueId,
          startTime: at(startHour),
          endTime: at(endHour),
          status,
        },
      });

    it("rejects an overlapping active booking", async () => {
      await insertBooking(customerIds[0], 10, 12, "CONFIRMED");

      const error = await insertBooking(customerIds[1], 11, 13).catch(
        (caught: unknown) => caught
      );

      expect(isExclusionViolation(error)).toBe(true);
    });

    it("allows back-to-back bookings", async () => {
      await insertBooking(customerIds[0], 10, 11);

      await expect(insertBooking(customerIds[1], 11, 12)).resolves.toBeDefined();
    });

    it("ignores cancelled bookings", async () => {
      await insertBooking(customerIds[0], 10, 12, "CANCELLED");

      await expect(insertBooking(customerIds[1], 10, 12)).resolves.toBeDefined();
    });
  });
});
