import { jest } from "@jest/globals";

type Content = { button?: { url: string } };
const queueEmail = jest.fn<(to: string, subject: string, content: Content, attachments?: unknown[]) => Promise<void>>(
  () => Promise.resolve()
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
const { buildIcs } = await import("../src/utils/ics.js");
const { normalizeBookingCode, newBookingCode } = await import("../src/utils/bookingCode.js");
const { expireWaitlist, NOTIFY_WINDOW_MS } = await import("../src/services/waitlist.service.js");

jest.setTimeout(40000);

const HOUR = 3_600_000;
const { backgroundIdle } = await import("../src/utils/background.js");
/** Waits for the request's follow-up work (notifications, emails, waitlist) to finish. */
const settle = () => backgroundIdle();
/** Top of the hour `hours` from now. */
const hourFromNow = (hours: number) => new Date(Math.ceil(Date.now() / HOUR) * HOUR + hours * HOUR);

describe("helpers", () => {
  it("normalises booking codes", () => {
    expect(newBookingCode()).toMatch(/^BK-[A-Z2-9]{6}$/);
    expect(normalizeBookingCode("bk 7f3k2q")).toBe("BK-7F3K2Q");
    expect(normalizeBookingCode("7F3K2Q")).toBe("BK-7F3K2Q");
  });

  it("builds a valid calendar file", () => {
    const ics = buildIcs({
      uid: "abc",
      start: new Date("2030-01-05T12:30:00Z"),
      end: new Date("2030-01-05T13:30:00Z"),
      summary: "BookIt: Turf, Chennai; 5-a-side",
      description: "x".repeat(120),
    });
    expect(ics).toContain("DTSTART:20300105T123000Z\r\n");
    expect(ics).toContain("SUMMARY:BookIt: Turf\\, Chennai\\; 5-a-side\r\n");
    // Long lines are folded to 75 characters.
    expect(ics.split("\r\n").every((line) => line.length <= 75)).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("booking features", () => {
  const u = `${Date.now()}`;
  const users: Record<string, { id: string; auth: { Authorization: string }; email: string }> = {};
  let venueId: string;

  const book = (who: string, start: Date, hours = 1) =>
    request(app)
      .post("/api/bookings")
      .set(users[who]!.auth)
      .send({ venueId, startTime: start.toISOString(), endTime: new Date(start.getTime() + hours * HOUR).toISOString() });

  beforeAll(async () => {
    for (const [label, role] of [["owner", "PROVIDER"], ["other", "PROVIDER"], ["alice", "USER"], ["bob", "USER"], ["carol", "USER"]] as const) {
      const user = await prisma.user.create({
        data: { name: `F ${label}`, email: `feat-${label}-${u}@example.com`, passwordHash: "x", role, emailVerifiedAt: new Date() },
      });
      users[label] = { id: user.id, email: user.email, auth: { Authorization: `Bearer ${generateAccessToken(user)}` } };
    }

    const venue = await prisma.venue.create({
      data: { name: `Features Arena ${u}`, pricePerHour: 600, ownerId: users.owner!.id, pendingHoldMinutes: 24 * 60 },
    });
    venueId = venue.id;
    await prisma.timeSlot.create({
      data: { venueId, startTime: new Date(Date.now() - 48 * HOUR), endTime: new Date(Date.now() + 100 * 24 * HOUR) },
    });
  });

  afterAll(async () => {
    await prisma.bookingParticipant.deleteMany({ where: { booking: { venueId } } });
    await prisma.booking.updateMany({ where: { venueId }, data: { rescheduledFromId: null } });
    await prisma.booking.deleteMany({ where: { venueId } });
    await prisma.recurringBooking.deleteMany({ where: { venueId } });
    await prisma.waitlistEntry.deleteMany({ where: { venueId } });
    await prisma.timeSlot.deleteMany({ where: { venueId } });
    await prisma.venue.deleteMany({ where: { id: venueId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((x) => x.id) } } });
    await prisma.$disconnect();
  });

  describe("reschedule", () => {
    it("moves a booking, even onto an overlapping time, and carries guests along", async () => {
      const created = await book("alice", hourFromNow(30), 2);
      expect(created.status).toBe(201);
      expect(created.body.booking.bookingCode).toMatch(/^BK-/);
      const oldId = created.body.booking.id;

      await request(app).post(`/api/bookings/${oldId}/participants`).set(users.alice!.auth).send({ invites: [{ email: "pal@example.com" }] });

      // One hour later: overlaps the current booking's second hour.
      const start = hourFromNow(31);
      const moved = await request(app)
        .put(`/api/bookings/${oldId}/reschedule`)
        .set(users.alice!.auth)
        .send({ startTime: start.toISOString(), endTime: new Date(start.getTime() + 2 * HOUR).toISOString() });

      expect(moved.status).toBe(200);
      expect(moved.body.booking).toMatchObject({ status: "PENDING", rescheduledFromId: oldId });
      expect(Number(moved.body.booking.totalPrice)).toBe(1200);

      const old = await prisma.booking.findUnique({ where: { id: oldId } });
      expect(old?.status).toBe("CANCELLED");
      expect(await prisma.bookingParticipant.count({ where: { bookingId: moved.body.booking.id } })).toBe(1);

      const detail = await request(app).get(`/api/bookings/${moved.body.booking.id}/details`).set(users.alice!.auth);
      expect(detail.body.booking.rescheduledFrom.id).toBe(oldId);
      expect(detail.body.booking.timeline[0].label).toMatch(/Moved here/);
    });

    it("refuses taken times, other people's bookings and moves too close to the start", async () => {
      const mine = await book("alice", hourFromNow(40));
      const bobs = await book("bob", hourFromNow(42));
      expect(bobs.status).toBe(201);

      const onto = await request(app)
        .put(`/api/bookings/${mine.body.booking.id}/reschedule`)
        .set(users.alice!.auth)
        .send({ startTime: hourFromNow(42).toISOString(), endTime: hourFromNow(43).toISOString() });
      expect(onto.status).toBe(409);
      // Nothing changed.
      expect((await prisma.booking.findUnique({ where: { id: mine.body.booking.id } }))?.status).toBe("PENDING");

      const stranger = await request(app)
        .put(`/api/bookings/${mine.body.booking.id}/reschedule`)
        .set(users.bob!.auth)
        .send({ startTime: hourFromNow(45).toISOString(), endTime: hourFromNow(46).toISOString() });
      expect(stranger.status).toBe(404);

      const soon = await prisma.booking.create({
        data: { userId: users.alice!.id, venueId, startTime: hourFromNow(1), endTime: hourFromNow(2), status: "CONFIRMED", bookingCode: newBookingCode() },
      });
      const late = await request(app)
        .put(`/api/bookings/${soon.id}/reschedule`)
        .set(users.alice!.auth)
        .send({ startTime: hourFromNow(50).toISOString(), endTime: hourFromNow(51).toISOString() });
      expect(late.status).toBe(409);
    });
  });

  describe("weekly series", () => {
    it("books the free weeks, reports taken ones and cancels together", async () => {
      const first = hourFromNow(24 * 60);
      // Someone already has week 3.
      await prisma.booking.create({
        data: {
          userId: users.bob!.id,
          venueId,
          startTime: new Date(first.getTime() + 14 * 24 * HOUR),
          endTime: new Date(first.getTime() + 14 * 24 * HOUR + HOUR),
          status: "CONFIRMED",
          bookingCode: newBookingCode(),
        },
      });

      const body = { venueId, startTime: first.toISOString(), durationMinutes: 60, weeks: 4 };
      const preview = await request(app).post("/api/bookings/recurring/preview").set(users.carol!.auth).send(body);
      expect(preview.body.weeks.map((w: { available: boolean }) => w.available)).toEqual([true, true, false, true]);

      const series = await request(app).post("/api/bookings/recurring").set(users.carol!.auth).send(body);
      expect(series.status).toBe(201);
      expect(series.body).toMatchObject({ booked: 3, skipped: 1 });

      const bookings = await prisma.booking.findMany({ where: { recurringGroupId: series.body.groupId } });
      expect(bookings).toHaveLength(3);

      const cancel = await request(app).post(`/api/bookings/recurring/${series.body.groupId}/cancel`).set(users.carol!.auth);
      expect(cancel.body.cancelled).toBe(3);

      expect((await request(app).post("/api/bookings/recurring").set(users.carol!.auth).send({ ...body, weeks: 20 })).status).toBe(400);
    });
  });

  describe("waitlist", () => {
    it("hands a freed time to the first in line, then the next", async () => {
      const start = hourFromNow(80);
      const end = new Date(start.getTime() + HOUR);
      const range = { venueId, startTime: start.toISOString(), endTime: end.toISOString() };

      // Free time can't be waited for.
      expect((await request(app).post("/api/waitlist").set(users.bob!.auth).send(range)).status).toBe(409);

      const taken = await book("alice", start);
      expect(taken.status).toBe(201);

      const bob = await request(app).post("/api/waitlist").set(users.bob!.auth).send(range);
      const carol = await request(app).post("/api/waitlist").set(users.carol!.auth).send(range);
      expect([bob.status, bob.body.position, carol.body.position]).toEqual([201, 1, 2]);

      await request(app).patch(`/api/bookings/${taken.body.booking.id}/cancel`).set(users.alice!.auth);
      await settle();

      const status = async (id: string) => (await prisma.waitlistEntry.findUnique({ where: { id } }))?.status;
      expect(await status(bob.body.entry.id)).toBe("NOTIFIED");
      expect(await status(carol.body.entry.id)).toBe("WAITING");
      expect(await prisma.notification.count({ where: { userId: users.bob!.id, type: "WAITLIST_AVAILABLE" } })).toBe(1);

      // Bob doesn't act in time: Carol is next.
      await expireWaitlist(new Date(Date.now() + NOTIFY_WINDOW_MS + 1000));
      expect(await status(bob.body.entry.id)).toBe("EXPIRED");
      expect(await status(carol.body.entry.id)).toBe("NOTIFIED");

      // Carol books it: her entry is done.
      expect((await book("carol", start)).status).toBe(201);
      await settle();
      expect(await status(carol.body.entry.id)).toBe("BOOKED");
    });
  });

  describe("invites", () => {
    it("emails friends a link to accept, and shows accepted guests the booking", async () => {
      const booking = await book("alice", hourFromNow(100));
      queueEmail.mockClear();

      const invited = await request(app)
        .post(`/api/bookings/${booking.body.booking.id}/participants`)
        .set(users.alice!.auth)
        .send({ invites: [{ email: users.bob!.email, name: "Bob" }, { email: "stranger@example.com" }, { email: users.alice!.email }] });
      await settle();

      // The organiser isn't invited to their own booking.
      expect(invited.body.participants.map((p: { status: string }) => p.status)).toEqual(["INVITED", "INVITED"]);
      const link = queueEmail.mock.calls.find(([to]) => to === users.bob!.email)![2].button!.url;
      const token = link.split("/invites/")[1]!;

      const info = await request(app).get(`/api/invites/${token}`);
      expect(info.body.invite).toMatchObject({ organiser: "F alice", status: "INVITED" });

      expect((await request(app).get(`/api/bookings/${booking.body.booking.id}/details`).set(users.bob!.auth)).status).toBe(404);

      const accepted = await request(app).post(`/api/invites/${token}/respond`).set(users.bob!.auth).send({ accept: true });
      expect(accepted.body.status).toBe("ACCEPTED");

      const detail = await request(app).get(`/api/bookings/${booking.body.booking.id}/details`).set(users.bob!.auth);
      expect(detail.status).toBe(200);
      // Guests don't see the organiser's email.
      expect(detail.body.booking.user.email).toBeNull();

      expect((await request(app).post(`/api/bookings/${booking.body.booking.id}/participants`).set(users.bob!.auth).send({ invites: [{ email: "x@example.com" }] })).status).toBe(404);
      expect((await request(app).get("/api/invites/not-a-token")).status).toBe(404);
    });
  });

  describe("check-in", () => {
    it("checks in by code inside the window, once", async () => {
      // Its own venue, so bookings from other tests can't overlap these.
      const desk = await prisma.venue.create({ data: { name: `Check-in desk ${u}`, ownerId: users.owner!.id } });
      const make = (startHours: number, status: "CONFIRMED" | "PENDING" = "CONFIRMED") =>
        prisma.booking.create({
          data: {
            userId: users.alice!.id,
            venueId: desk.id,
            startTime: new Date(Date.now() + startHours * HOUR),
            endTime: new Date(Date.now() + (startHours + 1) * HOUR),
            status,
            bookingCode: newBookingCode(),
          },
        });
      const checkIn = (code: string, who = "owner") =>
        request(app).post("/api/check-in").set(users[who]!.auth).send({ code });

      const soon = await make(-0.5);
      const later = await make(5);
      const pending = await make(0.6, "PENDING");

      expect((await checkIn(later.bookingCode!)).status).toBe(409);
      expect((await checkIn(pending.bookingCode!)).status).toBe(409);
      expect((await checkIn(soon.bookingCode!, "other")).status).toBe(404);

      const ok = await checkIn(soon.bookingCode!.toLowerCase().replace("-", " "));
      expect(ok.status).toBe(200);
      expect(ok.body.booking.checkedInAt).toBeTruthy();
      expect((await checkIn(soon.bookingCode!)).status).toBe(409);

      const arrivals = await request(app).get("/api/provider/arrivals").query({ venueId: desk.id }).set(users.owner!.auth);
      expect(arrivals.body.bookings.some((b: { id: string }) => b.id === soon.id)).toBe(true);

      const started = await make(-3);
      const noShow = await request(app).patch(`/api/bookings/${started.id}/no-show`).set(users.owner!.auth).send({ noShow: true });
      expect(noShow.body.booking.noShow).toBe(true);
      expect((await request(app).patch(`/api/bookings/${soon.id}/no-show`).set(users.owner!.auth).send({ noShow: true })).status).toBe(409);

      await prisma.booking.deleteMany({ where: { venueId: desk.id } });
      await prisma.venue.delete({ where: { id: desk.id } });
    });
  });
});
