import { jest } from "@jest/globals";

const queueEmail = jest.fn<(to: string, subject: string, content: unknown) => Promise<void>>(() => Promise.resolve());

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
const { computeDiscount } = await import("../src/services/coupon.service.js");

jest.setTimeout(60000);

const HOUR = 3_600_000;
const { backgroundIdle } = await import("../src/utils/background.js");
/** Waits for the request's follow-up work (notifications, emails, waitlist) to finish. */
const settle = () => backgroundIdle();
const hourFromNow = (hours: number) => new Date(Math.ceil(Date.now() / HOUR) * HOUR + hours * HOUR);
const todayKey = () => new Date(Date.now() + 5.5 * HOUR).toISOString().slice(0, 10);

describe("computeDiscount", () => {
  it("applies percentages with a cap and never goes below zero", () => {
    expect(computeDiscount({ type: "PERCENT", value: 10 as never, maxDiscount: null }, 1500)).toBe(150);
    expect(computeDiscount({ type: "PERCENT", value: 50 as never, maxDiscount: 200 as never }, 1500)).toBe(200);
    expect(computeDiscount({ type: "FLAT", value: 300 as never, maxDiscount: null }, 200)).toBe(200);
  });
});

describe("admin and platform management", () => {
  const u = `${Date.now()}`;
  type Who = { id: string; email: string; auth: { Authorization: string } };
  const users: Record<string, Who> = {};
  const venueIds: string[] = [];
  let venueId: string;
  const couponIds: string[] = [];

  const book = (who: string, start: Date, extra: object = {}) =>
    request(app)
      .post("/api/bookings")
      .set(users[who]!.auth)
      .send({ venueId, startTime: start.toISOString(), endTime: new Date(start.getTime() + HOUR).toISOString(), ...extra });

  beforeAll(async () => {
    // Settings are global; start from the defaults.
    await prisma.platformSetting.deleteMany({ where: { key: "commissionPercent" } });
    for (const [label, role] of [
      ["admin", "ADMIN"],
      ["admin2", "ADMIN"],
      ["owner", "PROVIDER"],
      ["newOwner", "PROVIDER"],
      ["alice", "USER"],
      ["bob", "USER"],
      ["carol", "USER"],
    ] as const) {
      const user = await prisma.user.create({
        data: { name: `A ${label}`, email: `adm-${label}-${u}@example.com`, passwordHash: "x", role, emailVerifiedAt: new Date() },
      });
      users[label] = { id: user.id, email: user.email, auth: { Authorization: `Bearer ${generateAccessToken(user)}` } };
    }

    const venue = await prisma.venue.create({
      data: { name: `Admin Arena ${u}`, city: "Madurai", pricePerHour: 1000, ownerId: users.owner!.id },
    });
    venueId = venue.id;
    venueIds.push(venueId);
    await prisma.timeSlot.create({
      data: { venueId, startTime: new Date(Date.now() - 48 * HOUR), endTime: new Date(Date.now() + 60 * 24 * HOUR) },
    });
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { venueId: { in: venueIds } } });
    await prisma.booking.deleteMany({ where: { venueId: { in: venueIds } } });
    await prisma.coupon.deleteMany({ where: { id: { in: couponIds } } });
    await prisma.timeSlot.deleteMany({ where: { venueId: { in: venueIds } } });
    await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
    await prisma.platformSetting.deleteMany({ where: { key: "commissionPercent" } });
    const ids = Object.values(users).map((x) => x.id);
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("keeps admin routes admin-only", async () => {
    const res = await request(app).get("/api/admin/users").set(users.alice!.auth);
    expect(res.status).toBe(403);
  });

  describe("user status", () => {
    it("suspends with a reason, signs the user out and records who did it", async () => {
      await prisma.refreshToken.create({
        data: { userId: users.carol!.id, tokenHash: `h-${u}`, familyId: `f-${u}`, expiresAt: new Date(Date.now() + HOUR) },
      });

      const noReason = await request(app).patch(`/api/admin/users/${users.carol!.id}/status`).set(users.admin!.auth).send({ status: "SUSPENDED" });
      expect(noReason.status).toBe(400);

      const res = await request(app)
        .patch(`/api/admin/users/${users.carol!.id}/status`)
        .set(users.admin!.auth)
        .send({ status: "SUSPENDED", reason: "Spam bookings" });
      expect(res.status).toBe(200);
      expect(res.body.user.status).toBe("SUSPENDED");

      expect((await request(app).get("/api/users/me").set(users.carol!.auth)).status).toBe(403);
      expect(await prisma.refreshToken.count({ where: { userId: users.carol!.id, revokedAt: null } })).toBe(0);

      const log = await prisma.auditLog.findFirst({ where: { action: "user.suspended", entityId: users.carol!.id } });
      expect(log).toMatchObject({ actorId: users.admin!.id, reason: "Spam bookings" });
      expect(log!.before).toMatchObject({ status: "ACTIVE" });

      await settle();
      expect(queueEmail).toHaveBeenCalledWith(users.carol!.email, expect.stringContaining("suspended"), expect.anything());

      const detail = await request(app).get(`/api/admin/users/${users.carol!.id}`).set(users.admin!.auth);
      expect(detail.status).toBe(200);
      expect(detail.body.history[0].action).toBe("user.suspended");

      const back = await request(app).patch(`/api/admin/users/${users.carol!.id}/status`).set(users.admin!.auth).send({ status: "ACTIVE" });
      expect(back.body.user.status).toBe("ACTIVE");
      expect((await request(app).get("/api/users/me").set(users.carol!.auth)).status).toBe(200);
    });

    it("won't suspend yourself or another admin", async () => {
      const self = await request(app).patch(`/api/admin/users/${users.admin!.id}/status`).set(users.admin!.auth).send({ status: "BANNED", reason: "x" });
      expect(self.status).toBe(403);
      const other = await request(app).patch(`/api/admin/users/${users.admin2!.id}/status`).set(users.admin!.auth).send({ status: "BANNED", reason: "x" });
      expect(other.status).toBe(403);
    });

    it("filters the user list by status and text", async () => {
      const res = await request(app).get("/api/admin/users").query({ q: `adm-alice-${u}`, status: "ACTIVE" }).set(users.admin!.auth);
      expect(res.body.users.map((x: { id: string }) => x.id)).toEqual([users.alice!.id]);
    });
  });

  describe("venue approval", () => {
    let pendingId: string;

    it("hides a provider's new venue until an admin approves it", async () => {
      const created = await request(app).post("/api/venues").set(users.newOwner!.auth).send({ name: `Fresh Turf ${u}`, city: "Salem", pricePerHour: 500 });
      expect(created.status).toBe(201);
      expect(created.body.venue.approvalStatus).toBe("PENDING");
      pendingId = created.body.venue.id;
      venueIds.push(pendingId);

      const search = await request(app).get("/api/venues").query({ q: `Fresh Turf ${u}` });
      expect(search.body.venues).toHaveLength(0);
      expect((await request(app).get(`/api/venues/${pendingId}`)).status).toBe(404);
      // The owner still sees it, and can preview its booking page.
      expect((await request(app).get(`/api/venues/${pendingId}`).set(users.newOwner!.auth)).status).toBe(200);
      expect((await request(app).get(`/api/venues/${pendingId}/schedule`).query({ date: todayKey() })).status).toBe(404);
      expect((await request(app).get(`/api/venues/${pendingId}/schedule`).query({ date: todayKey() }).set(users.newOwner!.auth)).status).toBe(200);

      const queue = await request(app).get("/api/admin/venues").query({ approvalStatus: "PENDING" }).set(users.admin!.auth);
      expect(queue.body.venues.some((v: { id: string }) => v.id === pendingId)).toBe(true);
    });

    it("rejects with a reason, and editing sends it back for review", async () => {
      const noReason = await request(app).post(`/api/admin/venues/${pendingId}/review`).set(users.admin!.auth).send({ decision: "REJECTED" });
      expect(noReason.status).toBe(400);

      const rejected = await request(app)
        .post(`/api/admin/venues/${pendingId}/review`)
        .set(users.admin!.auth)
        .send({ decision: "REJECTED", reason: "Add photos" });
      expect(rejected.body.venue).toMatchObject({ approvalStatus: "REJECTED", rejectionReason: "Add photos" });

      await settle();
      expect(await prisma.notification.count({ where: { userId: users.newOwner!.id, type: "VENUE_REVIEWED" } })).toBe(1);

      const edited = await request(app).put(`/api/venues/${pendingId}`).set(users.newOwner!.auth).send({ description: "Now with photos" });
      expect(edited.body.venue.approvalStatus).toBe("PENDING");
    });

    it("approves it and customers can find it", async () => {
      const approved = await request(app).post(`/api/admin/venues/${pendingId}/review`).set(users.admin!.auth).send({ decision: "APPROVED" });
      expect(approved.body.venue.approvalStatus).toBe("APPROVED");
      expect((await request(app).get(`/api/venues/${pendingId}`)).status).toBe(200);
      expect(await prisma.auditLog.count({ where: { entityId: pendingId, action: { in: ["venue.approved", "venue.rejected"] } } })).toBe(2);
    });

    it("lets admins list venues straight away", async () => {
      const created = await request(app).post("/api/venues").set(users.admin!.auth).send({ name: `Admin Listed ${u}`, pricePerHour: 700 });
      venueIds.push(created.body.venue.id);
      expect(created.body.venue.approvalStatus).toBe("APPROVED");
    });

    it("hides a suspended provider's venues and refuses bookings there", async () => {
      await prisma.user.update({ where: { id: users.owner!.id }, data: { status: "SUSPENDED" } });
      try {
        expect((await request(app).get(`/api/venues/${venueId}`)).status).toBe(404);
        expect((await book("alice", hourFromNow(200))).status).toBe(404);
      } finally {
        await prisma.user.update({ where: { id: users.owner!.id }, data: { status: "ACTIVE" } });
      }
    });
  });

  describe("review moderation", () => {
    let reviewId: string;

    beforeAll(async () => {
      const make = async (who: string, rating: number, hoursAgo: number) => {
        const booking = await prisma.booking.create({
          data: {
            userId: users[who]!.id,
            venueId,
            startTime: new Date(Date.now() - hoursAgo * HOUR),
            endTime: new Date(Date.now() - (hoursAgo - 1) * HOUR),
            status: "COMPLETED",
          },
        });
        const res = await request(app).post("/api/reviews").set(users[who]!.auth).send({ bookingId: booking.id, rating });
        expect(res.status).toBe(201);
        return res.body.review?.id ?? (await prisma.review.findUnique({ where: { bookingId: booking.id } }))!.id;
      };
      await make("alice", 5, 30);
      reviewId = await make("bob", 1, 40);
    });

    it("flags a reported review; the author can't report their own", async () => {
      expect((await request(app).post(`/api/reviews/${reviewId}/report`).set(users.bob!.auth).send({ reason: "mine" })).status).toBe(400);

      const res = await request(app).post(`/api/reviews/${reviewId}/report`).set(users.alice!.auth).send({ reason: "Abusive language" });
      expect(res.status).toBe(204);
      expect((await request(app).post(`/api/reviews/${reviewId}/report`).set(users.alice!.auth).send({ reason: "again" })).status).toBe(409);

      const queue = await request(app).get("/api/admin/reviews").query({ status: "FLAGGED" }).set(users.admin!.auth);
      const flagged = queue.body.reviews.find((r: { id: string }) => r.id === reviewId);
      expect(flagged.reports[0].reason).toBe("Abusive language");
    });

    it("hiding removes it from the page and the rating; restoring brings it back", async () => {
      expect((await prisma.venue.findUnique({ where: { id: venueId } }))!.avgRating).toBe(3);

      const hidden = await request(app).post(`/api/admin/reviews/${reviewId}/moderate`).set(users.admin!.auth).send({ status: "HIDDEN", note: "Abuse" });
      expect(hidden.body.review.status).toBe("HIDDEN");
      expect(hidden.body.review.reports.every((r: { resolvedAt: string | null }) => r.resolvedAt)).toBe(true);

      const venue = await prisma.venue.findUnique({ where: { id: venueId } });
      expect(venue).toMatchObject({ avgRating: 5, reviewCount: 1 });
      const list = await request(app).get(`/api/venues/${venueId}/reviews`);
      expect(list.body.reviews.map((r: { id: string }) => r.id)).not.toContain(reviewId);

      await request(app).post(`/api/admin/reviews/${reviewId}/moderate`).set(users.admin!.auth).send({ status: "VISIBLE" });
      expect((await prisma.venue.findUnique({ where: { id: venueId } }))!.reviewCount).toBe(2);
    });
  });

  describe("coupons", () => {
    it("validates the rules when an admin creates one", async () => {
      const bad = await request(app).post("/api/admin/coupons").set(users.admin!.auth).send({ code: `BAD${u}`, type: "PERCENT", value: 150 });
      expect(bad.status).toBe(400);

      const res = await request(app)
        .post("/api/admin/coupons")
        .set(users.admin!.auth)
        .send({ code: `play${u}`, type: "PERCENT", value: 20, maxDiscount: 150, perUserLimit: 1, maxUses: 2 });
      expect(res.status).toBe(201);
      expect(res.body.coupon.code).toBe(`PLAY${u}`);
      couponIds.push(res.body.coupon.id);

      const dup = await request(app).post("/api/admin/coupons").set(users.admin!.auth).send({ code: `PLAY${u}`, type: "FLAT", value: 10 });
      expect(dup.status).toBe(409);
    });

    it("previews and applies the discount, once per customer", async () => {
      const start = hourFromNow(72);
      const preview = await request(app)
        .post("/api/coupons/preview")
        .set(users.alice!.auth)
        .send({ code: `play${u}`, venueId, startTime: start.toISOString(), endTime: new Date(start.getTime() + HOUR).toISOString() });
      expect(preview.status).toBe(200);
      expect(preview.body.quote).toMatchObject({ subtotal: 1000, discount: 150, total: 850 });

      const booked = await book("alice", start, { couponCode: `play${u}` });
      expect(booked.status).toBe(201);
      expect(Number(booked.body.booking.totalPrice)).toBe(850);
      expect(Number(booked.body.booking.discountAmount)).toBe(150);

      const again = await book("alice", hourFromNow(74), { couponCode: `PLAY${u}` });
      expect(again.status).toBe(400);
      expect(again.body.message).toMatch(/already used/);
    });

    it("gives only the last use to one of two simultaneous bookings, and cancelling frees it", async () => {
      const [b, c] = await Promise.all([
        book("bob", hourFromNow(80), { couponCode: `PLAY${u}` }),
        book("carol", hourFromNow(82), { couponCode: `PLAY${u}` }),
      ]);
      expect([b.status, c.status].sort()).toEqual([201, 400]);

      const winner = b.status === 201 ? b : c;
      const loser = b.status === 201 ? "carol" : "bob";
      const owner = b.status === 201 ? "bob" : "carol";
      await request(app).patch(`/api/bookings/${winner.body.booking.id}/cancel`).set(users[owner]!.auth);

      expect((await book(loser, hourFromNow(84), { couponCode: `PLAY${u}` })).status).toBe(201);

      const list = await request(app).get("/api/admin/coupons").query({ q: `PLAY${u}` }).set(users.admin!.auth);
      expect(list.body.coupons[0]).toMatchObject({ uses: 2, totalDiscount: 300 });
    });

    it("won't delete a used code but can switch it off", async () => {
      const id = couponIds[0]!;
      expect((await request(app).delete(`/api/admin/coupons/${id}`).set(users.admin!.auth)).status).toBe(409);
      const off = await request(app).patch(`/api/admin/coupons/${id}`).set(users.admin!.auth).send({ isActive: false });
      expect(off.body.coupon.isActive).toBe(false);
      expect(await prisma.auditLog.count({ where: { entityId: id } })).toBe(2);
    });
  });

  describe("settings, analytics, search and audit log", () => {
    it("validates settings and rejects unknown keys", async () => {
      expect((await request(app).put("/api/admin/settings").set(users.admin!.auth).send({ nope: 1 })).status).toBe(400);
      expect((await request(app).put("/api/admin/settings").set(users.admin!.auth).send({ commissionPercent: 90 })).status).toBe(400);

      const res = await request(app).put("/api/admin/settings").set(users.admin!.auth).send({ commissionPercent: 12 });
      expect(res.body.settings.find((s: { key: string }) => s.key === "commissionPercent").value).toBe(12);
      expect(await prisma.auditLog.count({ where: { action: "settings.updated", actorId: users.admin!.id } })).toBe(1);
    });

    it("reports GMV, conversion, top venues and cohorts", async () => {
      const res = await request(app).get("/api/admin/analytics").query({ from: todayKey(), to: todayKey() }).set(users.admin!.auth);
      expect(res.status).toBe(200);
      expect(res.body.daily).toHaveLength(1);
      expect(res.body.summary.commissionPercent).toBe(12);
      expect(res.body.conversion.requests).toBeGreaterThan(0);
      expect(res.body.cohorts).toHaveLength(6);
      expect(res.body.cohorts[5].users).toBeGreaterThanOrEqual(3);
      expect((await request(app).get("/api/admin/analytics").query({ from: "2020-01-01", to: "2026-01-01" }).set(users.admin!.auth)).status).toBe(400);
    });

    it("finds users, venues and bookings", async () => {
      const code = (await prisma.booking.findFirst({ where: { venueId, bookingCode: { not: null } } }))!.bookingCode!;
      const byName = await request(app).get("/api/admin/search").query({ q: `Admin Arena ${u}` }).set(users.admin!.auth);
      expect(byName.body.venues.map((v: { id: string }) => v.id)).toContain(venueId);
      const byCode = await request(app).get("/api/admin/search").query({ q: code.toLowerCase() }).set(users.admin!.auth);
      expect(byCode.body.bookings[0].bookingCode).toBe(code);
    });

    it("lists the audit log with filters", async () => {
      const res = await request(app).get("/api/admin/audit-logs").query({ action: "venue.", actorId: users.admin!.id }).set(users.admin!.auth);
      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBeGreaterThanOrEqual(2);
      expect(res.body.logs.every((l: { action: string }) => l.action.startsWith("venue."))).toBe(true);
      expect(res.body.actions).toContain("user.suspended");
    });
  });
});
