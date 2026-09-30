import { jest } from "@jest/globals";

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
const { default: app } = await import("../src/app.js");
const { default: prisma } = await import("../src/config/prisma.js");
const { generateAccessToken } = await import("../src/utils/jwt.js");
const { calculatePrice } = await import("../src/services/pricing.service.js");
const { quoteRefund } = await import("../src/services/cancellation.service.js");
const { csvCell } = await import("../src/services/providerAnalytics.service.js");

jest.setTimeout(30000);

const HOUR = 3_600_000;
const IST = "Asia/Kolkata";
const IST_OFFSET = 5.5 * HOUR;

/** YYYY-MM-DD of the IST day `days` from today. */
const istDate = (days: number) =>
  new Date(Date.now() + IST_OFFSET + days * 24 * HOUR).toISOString().slice(0, 10);

/** UTC instant of hh:mm IST on an IST date. */
const ist = (date: string, hour: number, minute = 0) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - IST_OFFSET + hour * HOUR + minute * 60_000);

const rule = (overrides: Partial<Parameters<typeof calculatePrice>[1][number]>) => ({
  id: "r",
  name: "Rule",
  daysOfWeek: [],
  startTime: "00:00",
  endTime: "24:00",
  validFrom: null,
  validTo: null,
  type: "FIXED" as const,
  value: 1000,
  priority: 0,
  isActive: true,
  ...overrides,
});

describe("price calculation", () => {
  // 2030-01-05 is a Saturday.
  const sat = "2030-01-05";

  it("charges the base rate with no rules", () => {
    const quote = calculatePrice(800, [], ist(sat, 10), ist(sat, 11, 30), IST);
    expect(quote.total).toBe(1200);
    expect(quote.breakdown).toHaveLength(1);
    expect(quote.breakdown[0]).toMatchObject({ label: "Standard rate", ratePerHour: 800 });
  });

  it("splits a booking that runs into peak hours", () => {
    const peak = rule({ name: "Evening peak", startTime: "18:00", endTime: "22:00", value: 1500 });
    const quote = calculatePrice(1000, [peak], ist(sat, 17), ist(sat, 19), IST);

    expect(quote.total).toBe(2500);
    expect(quote.breakdown.map((line) => [line.label, line.amount])).toEqual([
      ["Standard rate", 1000],
      ["Evening peak", 1500],
    ]);
  });

  it("applies multipliers, weekdays and priority", () => {
    const weekend = rule({ name: "Weekend", daysOfWeek: [0, 6], type: "MULTIPLIER", value: 1.5 });
    const holiday = rule({ name: "Holiday", validFrom: new Date("2030-01-05"), validTo: new Date("2030-01-05"), value: 3000, priority: 10 });

    expect(calculatePrice(1000, [weekend], ist(sat, 10), ist(sat, 11), IST).total).toBe(1500);
    // Friday is not the weekend.
    expect(calculatePrice(1000, [weekend], ist("2030-01-04", 10), ist("2030-01-04", 11), IST).total).toBe(1000);
    // The higher priority rule wins where both match.
    expect(calculatePrice(1000, [weekend, holiday], ist(sat, 10), ist(sat, 11), IST).total).toBe(3000);
  });

  it("handles overnight rules on the day they start", () => {
    const late = rule({ name: "Late night", daysOfWeek: [6], startTime: "22:00", endTime: "02:00", value: 500 });
    // Saturday 23:00 to Sunday 01:00 is all "Saturday night".
    const quote = calculatePrice(1000, [late], ist(sat, 23), ist(sat, 25), IST);
    expect(quote.total).toBe(1000);
    // Friday night isn't covered.
    expect(calculatePrice(1000, [late], ist("2030-01-04", 23), ist("2030-01-04", 24), IST).total).toBe(1000);
  });
});

describe("refund policy", () => {
  const policy = [
    { hoursBefore: 6, refundPercent: 50 },
    { hoursBefore: 24, refundPercent: 100 },
  ];
  const at = (hoursAhead: number) => new Date(Date.now() + hoursAhead * HOUR);
  const quote = (hoursAhead: number, extra: Partial<Parameters<typeof quoteRefund>[0]> = {}) =>
    quoteRefund({
      policy,
      startTime: at(hoursAhead),
      totalPrice: 1000,
      status: "CONFIRMED",
      cancelledByVenue: false,
      ...extra,
    });

  it("uses the first tier the cancellation still meets", () => {
    expect(quote(48)).toMatchObject({ refundPercent: 100, refundAmount: 1000 });
    expect(quote(10)).toMatchObject({ refundPercent: 50, refundAmount: 500 });
    expect(quote(2)).toMatchObject({ refundPercent: 0, refundAmount: 0 });
  });

  it("refunds fully without a policy, for venue cancellations and unconfirmed requests", () => {
    expect(quote(2, { policy: null }).refundPercent).toBe(100);
    expect(quote(2, { cancelledByVenue: true }).refundPercent).toBe(100);
    expect(quote(2, { status: "PENDING" }).refundPercent).toBe(100);
  });
});

describe("CSV cells", () => {
  it("quotes separators and defuses spreadsheet formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+91 98765")).toBe("'+91 98765");
    expect(csvCell(null)).toBe("");
  });
});

describe("provider tools API", () => {
  const u = `${Date.now()}`;
  let ownerId: string;
  let otherOwnerId: string;
  let customerId: string;
  let owner: { Authorization: string };
  let otherOwner: { Authorization: string };
  let customer: { Authorization: string };
  let venueId: string;

  const day = istDate(3);

  beforeAll(async () => {
    const make = (label: string, role: "USER" | "PROVIDER") =>
      prisma.user.create({
        data: {
          name: `Tools ${label}`,
          email: `tools-${label}-${u}@example.com`,
          passwordHash: "x",
          role,
          emailVerifiedAt: new Date(),
        },
      });
    const o = await make("owner", "PROVIDER");
    const oo = await make("other", "PROVIDER");
    const c = await make("customer", "USER");
    ownerId = o.id;
    otherOwnerId = oo.id;
    customerId = c.id;
    owner = { Authorization: `Bearer ${generateAccessToken(o)}` };
    otherOwner = { Authorization: `Bearer ${generateAccessToken(oo)}` };
    customer = { Authorization: `Bearer ${generateAccessToken(c)}` };

    const venue = await prisma.venue.create({
      data: { name: `Tools Arena ${u}`, pricePerHour: 1000, ownerId, city: `Toolcity${u}` },
    });
    venueId = venue.id;
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { venueId } });
    await prisma.booking.deleteMany({ where: { venueId } });
    await prisma.timeSlot.deleteMany({ where: { venueId } });
    await prisma.venue.deleteMany({ where: { id: venueId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId, customerId] } } });
    await prisma.$disconnect();
  });

  const book = (start: Date, end: Date) =>
    request(app)
      .post("/api/bookings")
      .set(customer)
      .send({ venueId, startTime: start.toISOString(), endTime: end.toISOString() });

  describe("slot templates", () => {
    it("previews, generates and skips days that already have slots", async () => {
      const created = await request(app)
        .post(`/api/venues/${venueId}/templates`)
        .set(owner)
        .send({ name: "Every day", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "06:00", endTime: "23:00" });
      expect(created.status).toBe(201);

      const preview = await request(app)
        .post(`/api/venues/${venueId}/templates/generate`)
        .set(owner)
        .send({ days: 3, fromDate: istDate(2), dryRun: true });
      expect(preview.body.created).toBe(0);
      expect(preview.body.planned).toHaveLength(3);
      expect(preview.body.planned[0]).toMatchObject({ date: istDate(2), startTime: "06:00", endTime: "23:00" });

      const generated = await request(app)
        .post(`/api/venues/${venueId}/templates/generate`)
        .set(owner)
        .send({ days: 5, fromDate: istDate(2) });
      expect(generated.body.created).toBe(5);

      const again = await request(app)
        .post(`/api/venues/${venueId}/templates/generate`)
        .set(owner)
        .send({ days: 5, fromDate: istDate(2) });
      expect(again.body.created).toBe(0);
      expect(again.body.skipped).toHaveLength(5);

      const slot = await prisma.timeSlot.findFirst({ where: { venueId, startTime: ist(day, 6) } });
      expect(slot?.endTime).toEqual(ist(day, 23));
      expect(slot?.templateId).toBe(created.body.template.id);
    });

    it("only lets the owner manage templates", async () => {
      expect((await request(app).get(`/api/venues/${venueId}/templates`).set(otherOwner)).status).toBe(403);
      expect((await request(app).get(`/api/venues/${venueId}/templates`).set(customer)).status).toBe(403);
      const bad = await request(app)
        .post(`/api/venues/${venueId}/templates`)
        .set(owner)
        .send({ daysOfWeek: [], startTime: "10:00", endTime: "09:00" });
      expect(bad.status).toBe(400);
    });
  });

  describe("booking rules", () => {
    it("enforces the venue's booking step and maximum length", async () => {
      expect((await book(ist(day, 7), ist(day, 7, 30))).status).toBe(400);

      await request(app).put(`/api/venues/${venueId}`).set(owner).send({ slotMinutes: 30, maxBookingMinutes: 120 });
      expect((await book(ist(day, 7), ist(day, 7, 30))).status).toBe(201);
      expect((await book(ist(day, 8), ist(day, 10, 30))).status).toBe(400);

      const invalid = await request(app).put(`/api/venues/${venueId}`).set(owner).send({ slotMinutes: 30, maxBookingMinutes: 45 });
      expect(invalid.status).toBe(400);

      await request(app).put(`/api/venues/${venueId}`).set(owner).send({ slotMinutes: 60, maxBookingMinutes: 240 });
    });

    it("prices bookings with the rules in force and stores the breakdown", async () => {
      const peak = await request(app)
        .post(`/api/venues/${venueId}/pricing-rules`)
        .set(owner)
        .send({ name: "Evening peak", startTime: "18:00", endTime: "22:00", type: "FIXED", value: 2000 });
      expect(peak.status).toBe(201);

      const quote = await request(app)
        .get(`/api/venues/${venueId}/quote`)
        .query({ startTime: ist(day, 17).toISOString(), endTime: ist(day, 19).toISOString() });
      expect(quote.body.quote.total).toBe(3000);

      const booking = await book(ist(day, 17), ist(day, 19));
      expect(booking.status).toBe(201);
      expect(Number(booking.body.booking.totalPrice)).toBe(3000);
      expect(booking.body.booking.priceBreakdown.map((line: { label: string }) => line.label)).toEqual([
        "Standard rate",
        "Evening peak",
      ]);
    });

    it("blocks bookings in a closure and hides the venue from search", async () => {
      const blackout = await request(app)
        .post(`/api/venues/${venueId}/blackouts`)
        .set(owner)
        .send({ startTime: ist(day, 12).toISOString(), endTime: ist(day, 14).toISOString(), reason: "Resurfacing" });
      expect(blackout.status).toBe(201);
      expect(blackout.body.affectedBookings).toBe(0);

      const inside = await book(ist(day, 12), ist(day, 13));
      expect(inside.status).toBe(409);
      expect(inside.body.message).toMatch(/closed.*Resurfacing/);

      const search = await request(app).get("/api/venues").query({ city: `Toolcity${u}`, date: day, time: "12:00" });
      expect(search.body.venues).toHaveLength(0);
      const later = await request(app).get("/api/venues").query({ city: `Toolcity${u}`, date: day, time: "15:00" });
      expect(later.body.venues).toHaveLength(1);

      const schedule = await request(app).get(`/api/venues/${venueId}/schedule`).query({ date: day });
      expect(schedule.body.schedule.windows).toHaveLength(1);
      const kinds = schedule.body.schedule.busy.map((busy: { kind: string }) => busy.kind);
      expect(kinds).toEqual(expect.arrayContaining(["booked", "closed"]));
      // No personal data in the public schedule.
      expect(JSON.stringify(schedule.body)).not.toMatch(/userId|email/);
    });
  });

  describe("cancellation refunds", () => {
    it("quotes and records the refund from the venue's policy", async () => {
      await request(app)
        .put(`/api/venues/${venueId}`)
        .set(owner)
        .send({ cancellationPolicy: [{ hoursBefore: 24, refundPercent: 100 }, { hoursBefore: 1, refundPercent: 50 }] });

      // Confirmed booking starting in about 10 hours.
      const start = new Date(Math.ceil((Date.now() + 10 * HOUR) / HOUR) * HOUR);
      const booking = await prisma.booking.create({
        data: {
          userId: customerId,
          venueId,
          startTime: start,
          endTime: new Date(start.getTime() + HOUR),
          status: "CONFIRMED",
          totalPrice: 1000,
        },
      });

      const quote = await request(app).get(`/api/bookings/${booking.id}/cancellation-quote`).set(customer);
      expect(quote.body.quote).toMatchObject({ refundPercent: 50, refundAmount: 500 });

      const cancelled = await request(app).patch(`/api/bookings/${booking.id}/cancel`).set(customer);
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.booking).toMatchObject({ status: "CANCELLED", refundPercent: 50 });
      expect(Number(cancelled.body.booking.refundAmount)).toBe(500);
      expect(cancelled.body.booking.cancelledById).toBe(customerId);
    });

    it("refunds in full when the venue cancels", async () => {
      const start = new Date(Math.ceil((Date.now() + 30 * 60_000) / HOUR) * HOUR + 12 * HOUR);
      const booking = await prisma.booking.create({
        data: { userId: customerId, venueId, startTime: start, endTime: new Date(start.getTime() + HOUR), status: "CONFIRMED", totalPrice: 800 },
      });

      const cancelled = await request(app).patch(`/api/bookings/${booking.id}/cancel`).set(owner);
      expect(cancelled.body.booking.refundPercent).toBe(100);
    });
  });

  describe("walk-ins and blocked time", () => {
    const manual = (headers: { Authorization: string }, body: Record<string, unknown>) =>
      request(app).post("/api/bookings/manual").set(headers).send({ venueId, ...body });

    it("lets the owner add walk-ins and blocks that respect other bookings", async () => {
      const walkIn = await manual(owner, {
        kind: "WALK_IN",
        startTime: ist(day, 20).toISOString(),
        endTime: ist(day, 21).toISOString(),
        guestName: "=HYPERLINK(\"http://evil\")",
        guestPhone: "+91 90000 00000",
      });
      expect(walkIn.status).toBe(201);
      expect(walkIn.body.booking).toMatchObject({ status: "CONFIRMED", source: "WALK_IN" });
      // Evening peak applies to walk-ins too.
      expect(Number(walkIn.body.booking.totalPrice)).toBe(2000);

      const clash = await manual(owner, {
        kind: "BLOCK",
        startTime: ist(day, 20, 30).toISOString(),
        endTime: ist(day, 22).toISOString(),
      });
      expect(clash.status).toBe(409);

      const block = await manual(owner, {
        kind: "BLOCK",
        startTime: ist(day, 21).toISOString(),
        endTime: ist(day, 22).toISOString(),
        note: "Maintenance",
      });
      expect(block.status).toBe(201);
      expect(Number(block.body.booking.totalPrice)).toBe(0);

      // Nobody else can book over blocked time.
      expect((await book(ist(day, 21), ist(day, 22))).status).toBe(409);
    });

    it("rejects walk-ins from other people and without a name", async () => {
      const slot = { kind: "WALK_IN", startTime: ist(day, 9).toISOString(), endTime: ist(day, 10).toISOString(), guestName: "X" };
      expect((await manual(otherOwner, slot)).status).toBe(403);
      expect((await manual(customer, slot)).status).toBe(403);
      expect((await manual(owner, { ...slot, guestName: undefined })).status).toBe(400);
    });
  });

  describe("review replies", () => {
    it("lets only the owner reply, and shows the reply publicly", async () => {
      const booking = await prisma.booking.create({
        data: {
          userId: customerId,
          venueId,
          startTime: new Date(Date.now() - 5 * HOUR),
          endTime: new Date(Date.now() - 4 * HOUR),
          status: "COMPLETED",
          totalPrice: 1000,
        },
      });
      const review = await prisma.review.create({
        data: { userId: customerId, venueId, bookingId: booking.id, rating: 4, review: "Nice turf" },
      });

      expect((await request(app).put(`/api/reviews/${review.id}/reply`).set(otherOwner).send({ reply: "Hi" })).status).toBe(403);
      expect((await request(app).put(`/api/reviews/${review.id}/reply`).set(customer).send({ reply: "Hi" })).status).toBe(403);

      const reply = await request(app)
        .put(`/api/reviews/${review.id}/reply`)
        .set(owner)
        .send({ reply: "Thanks for playing!" });
      expect(reply.status).toBe(200);

      const publicList = await request(app).get(`/api/venues/${venueId}/reviews`);
      expect(publicList.body.reviews[0]).toMatchObject({ providerReply: "Thanks for playing!" });

      const unanswered = await request(app).get("/api/provider/reviews").query({ unanswered: "true" }).set(owner);
      expect(unanswered.body.reviews).toHaveLength(0);

      await request(app).delete(`/api/reviews/${review.id}/reply`).set(owner);
      const cleared = await request(app).get("/api/provider/reviews").query({ unanswered: "true" }).set(owner);
      expect(cleared.body.reviews).toHaveLength(1);
    });
  });

  describe("reports", () => {
    it("summarises revenue and occupancy, leaving out blocked time", async () => {
      const response = await request(app)
        .get("/api/provider/analytics")
        .query({ from: istDate(2), to: istDate(6) })
        .set(owner);

      expect(response.status).toBe(200);
      const { summary, daily, heatmap, perVenue } = response.body;

      // Confirmed/completed in range: the 20:00 walk-in (2000). The online
      // bookings in range are still PENDING, so not revenue yet.
      expect(summary.revenue).toBe(2000);
      expect(summary.walkIns).toBe(1);
      // Blocked time isn't a booking.
      expect(summary.byStatus.CONFIRMED).toBe(1);
      expect(summary.openHours).toBe(5 * 17);
      expect(daily).toHaveLength(5);
      expect(daily.find((row: { date: string }) => row.date === day).revenue).toBe(2000);

      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      const cell = heatmap.find((c: { weekday: number; hour: number }) => c.weekday === weekday && c.hour === 20);
      expect(cell).toMatchObject({ bookedHours: 1, openHours: 1 });
      expect(perVenue[0]).toMatchObject({ venueId, revenue: 2000 });
    });

    it("exports bookings as a safe CSV", async () => {
      const response = await request(app)
        .get("/api/provider/bookings/export")
        .query({ from: istDate(2), to: istDate(6) })
        .set(owner);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toMatch(/text\/csv/);
      expect(response.headers["content-disposition"]).toMatch(/attachment; filename="bookit-bookings-/);

      const lines = response.text.replace(/^﻿/, "").trim().split("\r\n");
      expect(lines[0]).toMatch(/^Booking ID,Venue,Type,Status,Date,Start,End/);
      const walkIn = lines.find((line) => line.includes("Walk-in"))!;
      expect(walkIn).toContain(`${day},20:00,21:00,1`);
      // The formula in the guest name is neutralised.
      expect(walkIn).toContain(`"'=HYPERLINK(""http://evil"")"`);
      expect(walkIn).toContain("'+91 90000 00000");
    });

    it("rejects ranges that are backwards or too long", async () => {
      expect((await request(app).get("/api/provider/analytics").query({ from: istDate(5), to: istDate(1) }).set(owner)).status).toBe(400);
      expect((await request(app).get("/api/provider/analytics").query({ from: "2020-01-01", to: "2030-01-01" }).set(owner)).status).toBe(400);
    });
  });
});
