import { jest } from "@jest/globals";

type QueuedEmail = { to: string; subject: string };
const queueEmail = jest.fn<(to: string, subject: string, content: unknown) => Promise<void>>(() =>
  Promise.resolve()
);

jest.unstable_mockModule("../src/services/email.service.js", () => ({
  queueEmail,
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
const { default: app } = await import("../src/app.js");
const { default: prisma } = await import("../src/config/prisma.js");
const { generateAccessToken } = await import("../src/utils/jwt.js");
const {
  completeFinishedBookings,
  describeStartsIn,
  expireOverdueBookings,
  sendDueReminders,
} = await import("../src/services/bookingLifecycle.service.js");

jest.setTimeout(30000);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Background notifications are fire-and-forget; give them a moment. */
const { backgroundIdle } = await import("../src/utils/background.js");
/** Waits for the request's follow-up work (notifications, emails, waitlist) to finish. */
const settle = () => backgroundIdle();

const emailsTo = (to: string): QueuedEmail[] =>
  queueEmail.mock.calls.filter(([recipient]) => recipient === to).map(([recipient, subject]) => ({
    to: recipient,
    subject,
  }));

describe("Booking lifecycle and notifications", () => {
  const unique = `${Date.now()}`;
  let ownerId: string;
  let ownerToken: string;
  let customerId: string;
  let customerToken: string;
  let otherId: string;
  let venueId: string;
  let customerEmail: string;

  // Each test books its own hour so tests never overlap one another.
  let nextHour = 30;
  const freshSlot = () => {
    const base = Date.now() + nextHour++ * HOUR;
    const startTime = new Date(Math.ceil(base / HOUR) * HOUR);
    return { startTime, endTime: new Date(startTime.getTime() + HOUR) };
  };

  const insertBooking = (data: {
    status: "PENDING" | "CONFIRMED";
    startTime: Date;
    endTime: Date;
    expiresAt?: Date | null;
    userId?: string;
  }) =>
    prisma.booking.create({
      data: {
        userId: data.userId ?? customerId,
        venueId,
        startTime: data.startTime,
        endTime: data.endTime,
        status: data.status,
        expiresAt: data.expiresAt ?? null,
      },
    });

  const notificationsOf = (userId: string) =>
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

  beforeAll(async () => {
    const make = (label: string, role: "USER" | "PROVIDER") =>
      prisma.user.create({
        data: {
          name: `Lifecycle ${label}`,
          email: `lifecycle-${label}-${unique}@example.com`,
          passwordHash: "test-password-hash",
          role,
          emailVerifiedAt: new Date(),
        },
      });

    const owner = await make("owner", "PROVIDER");
    const customer = await make("customer", "USER");
    const other = await make("other", "USER");
    ownerId = owner.id;
    customerId = customer.id;
    otherId = other.id;
    customerEmail = customer.email;
    ownerToken = generateAccessToken(owner);
    customerToken = generateAccessToken(customer);

    const venue = await prisma.venue.create({
      data: {
        name: `Lifecycle Venue ${unique}`,
        pricePerHour: 500,
        ownerId,
        pendingHoldMinutes: 60,
      },
    });
    venueId = venue.id;

    // Open from two days ago to ten days ahead.
    await prisma.timeSlot.create({
      data: {
        venueId,
        startTime: new Date(Date.now() - 48 * HOUR),
        endTime: new Date(Date.now() + 240 * HOUR),
      },
    });
  });

  afterEach(async () => {
    await prisma.booking.deleteMany({ where: { venueId } });
    await prisma.notification.deleteMany({ where: { userId: { in: [ownerId, customerId, otherId] } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: customerId } });
    queueEmail.mockClear();
  });

  afterAll(async () => {
    await prisma.timeSlot.deleteMany({ where: { venueId } });
    await prisma.venue.deleteMany({ where: { id: venueId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, customerId, otherId] } } });
    await prisma.$disconnect();
  });

  describe("pending hold", () => {
    it("gives new requests the venue's hold time and tells the owner", async () => {
      const { startTime, endTime } = freshSlot();

      const response = await request(app)
        .post("/api/bookings")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ venueId, startTime: startTime.toISOString(), endTime: endTime.toISOString() });
      await settle();

      expect(response.status).toBe(201);
      const expiresAt = new Date(response.body.booking.expiresAt).getTime();
      expect(Math.abs(expiresAt - (Date.now() + HOUR))).toBeLessThan(MINUTE);

      const ownerNotifications = await notificationsOf(ownerId);
      expect(ownerNotifications.map((n) => n.type)).toEqual(["BOOKING_REQUESTED"]);
      expect(emailsTo(`lifecycle-owner-${unique}@example.com`)).toHaveLength(1);
    });

    it("expires overdue requests, frees the time and tells both sides", async () => {
      const { startTime, endTime } = freshSlot();
      const booking = await insertBooking({
        status: "PENDING",
        startTime,
        endTime,
        expiresAt: new Date(Date.now() - MINUTE),
      });
      const stillPending = await insertBooking({
        status: "PENDING",
        ...freshSlot(),
        expiresAt: new Date(Date.now() + HOUR),
      });

      expect(await expireOverdueBookings()).toBe(1);
      await settle();

      expect((await prisma.booking.findUnique({ where: { id: booking.id } }))?.status).toBe("EXPIRED");
      expect((await prisma.booking.findUnique({ where: { id: stillPending.id } }))?.status).toBe("PENDING");

      expect((await notificationsOf(customerId)).map((n) => n.type)).toEqual(["BOOKING_EXPIRED"]);
      expect((await notificationsOf(ownerId)).map((n) => n.type)).toEqual(["BOOKING_EXPIRED"]);
      expect(emailsTo(customerEmail).map((e) => e.subject)).toEqual(["BookIt - Booking request expired"]);

      // Running again changes nothing.
      expect(await expireOverdueBookings()).toBe(0);

      // Someone else can now book that time.
      const rebook = await request(app)
        .post("/api/bookings")
        .set("Authorization", `Bearer ${generateAccessToken({ id: otherId, email: "x@example.com", role: "USER" })}`)
        .send({ venueId, startTime: startTime.toISOString(), endTime: endTime.toISOString() });
      expect(rebook.status).toBe(201);
    });

    it("releases an overdue request immediately when someone books over it", async () => {
      const { startTime, endTime } = freshSlot();
      const overdue = await insertBooking({
        status: "PENDING",
        startTime,
        endTime,
        expiresAt: new Date(Date.now() - MINUTE),
      });

      const response = await request(app)
        .post("/api/bookings")
        .set("Authorization", `Bearer ${generateAccessToken({ id: otherId, email: "x@example.com", role: "USER" })}`)
        .send({ venueId, startTime: startTime.toISOString(), endTime: endTime.toISOString() });
      await settle();

      expect(response.status).toBe(201);
      expect((await prisma.booking.findUnique({ where: { id: overdue.id } }))?.status).toBe("EXPIRED");
      expect((await notificationsOf(customerId)).map((n) => n.type)).toEqual(["BOOKING_EXPIRED"]);
    });

    it("refuses to confirm a request after its hold has passed", async () => {
      const booking = await insertBooking({
        status: "PENDING",
        ...freshSlot(),
        expiresAt: new Date(Date.now() - MINUTE),
      });

      const response = await request(app)
        .patch(`/api/bookings/${booking.id}/confirm`)
        .set("Authorization", `Bearer ${ownerToken}`);
      await settle();

      expect(response.status).toBe(409);
      expect(response.body.message).toMatch(/expired/i);
      expect((await prisma.booking.findUnique({ where: { id: booking.id } }))?.status).toBe("EXPIRED");
      expect((await notificationsOf(customerId)).map((n) => n.type)).toEqual(["BOOKING_EXPIRED"]);
    });

    it("confirming in time notifies the customer in-app and by email", async () => {
      const booking = await insertBooking({
        status: "PENDING",
        ...freshSlot(),
        expiresAt: new Date(Date.now() + HOUR),
      });

      const response = await request(app)
        .patch(`/api/bookings/${booking.id}/confirm`)
        .set("Authorization", `Bearer ${ownerToken}`);
      await settle();

      expect(response.status).toBe(200);
      expect(response.body.booking.status).toBe("CONFIRMED");
      expect((await notificationsOf(customerId)).map((n) => n.type)).toEqual(["BOOKING_CONFIRMED"]);
      expect(emailsTo(customerEmail).map((e) => e.subject)).toEqual(["BookIt - Booking confirmed"]);
    });

    it("a customer cancelling gets an email receipt but no in-app alert; the owner is told", async () => {
      const booking = await insertBooking({ status: "CONFIRMED", ...freshSlot() });

      const response = await request(app)
        .patch(`/api/bookings/${booking.id}/cancel`)
        .set("Authorization", `Bearer ${customerToken}`);
      await settle();

      expect(response.status).toBe(200);
      expect(await notificationsOf(customerId)).toHaveLength(0);
      expect(emailsTo(customerEmail).map((e) => e.subject)).toEqual(["BookIt - Booking cancelled"]);
      expect((await notificationsOf(ownerId)).map((n) => n.type)).toEqual(["BOOKING_CANCELLED"]);
    });
  });

  describe("auto-complete", () => {
    it("completes confirmed bookings after they end and nudges for a review", async () => {
      const ended = await insertBooking({
        status: "CONFIRMED",
        startTime: new Date(Date.now() - 3 * HOUR),
        endTime: new Date(Date.now() - 2 * HOUR),
      });
      const upcoming = await insertBooking({ status: "CONFIRMED", ...freshSlot() });

      expect(await completeFinishedBookings()).toBe(1);
      await settle();

      expect((await prisma.booking.findUnique({ where: { id: ended.id } }))?.status).toBe("COMPLETED");
      expect((await prisma.booking.findUnique({ where: { id: upcoming.id } }))?.status).toBe("CONFIRMED");
      expect((await notificationsOf(customerId)).map((n) => n.type)).toEqual(["BOOKING_COMPLETED"]);
      expect(await completeFinishedBookings()).toBe(0);
    });
  });

  describe("reminders", () => {
    it("sends the 24 h reminder once", async () => {
      const startTime = new Date(Date.now() + 20 * HOUR);
      await insertBooking({ status: "CONFIRMED", startTime, endTime: new Date(startTime.getTime() + HOUR) });

      expect(await sendDueReminders()).toBe(1);
      expect(await sendDueReminders()).toBe(0);
      await settle();

      const reminders = await notificationsOf(customerId);
      expect(reminders.map((n) => n.type)).toEqual(["BOOKING_REMINDER"]);
      expect(reminders[0]!.title).toBe("Coming up in about 20 hours");
      expect(emailsTo(customerEmail)).toHaveLength(1);
    });

    it("sends only the 2 h reminder for a booking starting soon", async () => {
      const startTime = new Date(Date.now() + 90 * MINUTE);
      const booking = await insertBooking({
        status: "CONFIRMED",
        startTime,
        endTime: new Date(startTime.getTime() + HOUR),
      });

      expect(await sendDueReminders()).toBe(1);
      expect(await sendDueReminders()).toBe(0);

      const stored = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(stored?.reminder2hSentAt).toBeInstanceOf(Date);
      expect(stored?.reminder24hSentAt).toBeInstanceOf(Date);
    });

    it("skips unconfirmed bookings", async () => {
      const startTime = new Date(Date.now() + 5 * HOUR);
      await insertBooking({
        status: "PENDING",
        startTime,
        endTime: new Date(startTime.getTime() + HOUR),
        expiresAt: new Date(Date.now() + HOUR),
      });

      expect(await sendDueReminders()).toBe(0);
    });

    it("describes the time until start in plain words", () => {
      const now = new Date("2030-01-01T10:00:00Z");
      expect(describeStartsIn(new Date("2030-01-01T11:55:00Z"), now)).toBe("in about 2 hours");
      expect(describeStartsIn(new Date("2030-01-01T11:00:00Z"), now)).toBe("in about an hour");
      expect(describeStartsIn(new Date("2030-01-01T10:42:00Z"), now)).toBe("in about 40 minutes");
    });
  });

  describe("preferences", () => {
    it("respects turning off email or in-app for a type", async () => {
      const prefs = await request(app)
        .put("/api/notifications/preferences")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({
          preferences: [
            { type: "BOOKING_REMINDER", channel: "EMAIL", enabled: false },
            { type: "BOOKING_COMPLETED", channel: "IN_APP", enabled: false },
          ],
        });
      expect(prefs.status).toBe(200);

      const startTime = new Date(Date.now() + 20 * HOUR);
      await insertBooking({ status: "CONFIRMED", startTime, endTime: new Date(startTime.getTime() + HOUR) });
      await insertBooking({
        status: "CONFIRMED",
        startTime: new Date(Date.now() - 5 * HOUR),
        endTime: new Date(Date.now() - 4 * HOUR),
      });

      await sendDueReminders();
      await completeFinishedBookings();
      await settle();

      // Reminder: in-app only. Completion: nothing in-app.
      expect((await notificationsOf(customerId)).map((n) => n.type)).toEqual(["BOOKING_REMINDER"]);
      expect(emailsTo(customerEmail)).toHaveLength(0);
    });
  });

  describe("notifications API", () => {
    const seedNotifications = () =>
      prisma.notification.createManyAndReturn({
        data: [1, 2, 3].map((n) => ({
          userId: customerId,
          type: "BOOKING_CONFIRMED" as const,
          title: `Note ${n}`,
          body: "Body",
        })),
      });

    it("lists newest first with the unread count, and marks read", async () => {
      const [first] = await seedNotifications();
      const auth = { Authorization: `Bearer ${customerToken}` };

      const list = await request(app).get("/api/notifications").set(auth);
      expect(list.status).toBe(200);
      expect(list.body.notifications).toHaveLength(3);
      expect(list.body.unreadCount).toBe(3);
      expect(list.body.pagination.total).toBe(3);

      const read = await request(app).patch(`/api/notifications/${first!.id}/read`).set(auth);
      expect(read.status).toBe(200);
      expect(read.body.notification.read).toBe(true);

      const count = await request(app).get("/api/notifications/unread-count").set(auth);
      expect(count.body.unreadCount).toBe(2);

      const unreadOnly = await request(app).get("/api/notifications?unread=true").set(auth);
      expect(unreadOnly.body.notifications).toHaveLength(2);

      const all = await request(app).post("/api/notifications/read-all").set(auth);
      expect(all.body.updated).toBe(2);
      expect((await request(app).get("/api/notifications/unread-count").set(auth)).body.unreadCount).toBe(0);
    });

    it("hides other users' notifications", async () => {
      const [mine] = await seedNotifications();

      const response = await request(app)
        .patch(`/api/notifications/${mine!.id}/read`)
        .set("Authorization", `Bearer ${ownerToken}`);

      expect(response.status).toBe(404);
    });

    it("returns the full preference matrix and validates updates", async () => {
      const auth = { Authorization: `Bearer ${customerToken}` };

      const matrix = await request(app).get("/api/notifications/preferences").set(auth);
      expect(matrix.status).toBe(200);
      expect(matrix.body.preferences).toHaveLength(20);
      expect(matrix.body.preferences.every((p: { enabled: boolean }) => p.enabled)).toBe(true);

      const invalid = await request(app)
        .put("/api/notifications/preferences")
        .set(auth)
        .send({ preferences: [{ type: "NOPE", channel: "EMAIL", enabled: false }] });
      expect(invalid.status).toBe(400);
    });
  });
});
