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
const { backgroundIdle } = await import("../src/utils/background.js");
const { fakeControls, fakeWebhook, simulateCheckout } = await import("../src/payments/fake.js");
const { processRefund, reconcilePayments } = await import("../src/services/payment.service.js");
const { expireOverdueBookings } = await import("../src/services/bookingLifecycle.service.js");
const { getSetting } = await import("../src/services/settings.service.js");

jest.setTimeout(60000);

const HOUR = 3_600_000;
const hourFromNow = (hours: number) => new Date(Math.ceil(Date.now() / HOUR) * HOUR + hours * HOUR);
const iso = (date: Date) => date.toISOString();

describe("online payments", () => {
  const u = `${Date.now()}`;
  const users: Record<string, { id: string; auth: { Authorization: string } }> = {};
  let onlineVenueId: string;
  let venueAtVenueId: string;
  let commissionPercent: number;

  const book = (who: string, start: Date, venueId = onlineVenueId, hours = 1) =>
    request(app)
      .post("/api/bookings")
      .set(users[who]!.auth)
      .send({ venueId, startTime: iso(start), endTime: iso(new Date(start.getTime() + hours * HOUR)) });

  /** Pays the order in the fake checkout and reports it the way the browser would. */
  const payAndVerify = async (who: string, orderId: string) => {
    const paid = simulateCheckout(orderId, "success");
    const verified = await request(app)
      .post("/api/payments/verify")
      .set(users[who]!.auth)
      .send({ orderId, paymentId: paid.paymentId, signature: paid.signature });
    return { paid, verified };
  };

  const deliver = (webhook: { body: Buffer; signature: string; eventId: string }) =>
    request(app)
      .post("/api/payments/webhook")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", webhook.signature)
      .set("x-razorpay-event-id", webhook.eventId)
      .send(webhook.body.toString("utf8"));

  const paymentOf = (bookingId: string) => prisma.payment.findFirstOrThrow({ where: { bookingId }, include: { refunds: true } });

  beforeAll(async () => {
    for (const [label, role] of [["owner", "PROVIDER"], ["alice", "USER"], ["bob", "USER"], ["admin", "ADMIN"]] as const) {
      const user = await prisma.user.create({
        data: { name: `P ${label}`, email: `pay-${label}-${u}@example.com`, passwordHash: "x", role, emailVerifiedAt: new Date() },
      });
      users[label] = { id: user.id, auth: { Authorization: `Bearer ${generateAccessToken(user)}` } };
    }

    const online = await prisma.venue.create({
      data: {
        name: `Paid Arena ${u}`,
        pricePerHour: 600,
        ownerId: users.owner!.id,
        paymentMode: "PAY_ONLINE",
        // Full refund up to 24 h before, half up to 1 h before.
        cancellationPolicy: [
          { hoursBefore: 24, refundPercent: 100 },
          { hoursBefore: 1, refundPercent: 50 },
        ],
      },
    });
    const atVenue = await prisma.venue.create({
      data: { name: `Cash Arena ${u}`, pricePerHour: 500, ownerId: users.owner!.id },
    });
    onlineVenueId = online.id;
    venueAtVenueId = atVenue.id;

    for (const venueId of [onlineVenueId, venueAtVenueId]) {
      await prisma.timeSlot.create({
        data: { venueId, startTime: new Date(Date.now() - 48 * HOUR), endTime: new Date(Date.now() + 60 * 24 * HOUR) },
      });
    }
    commissionPercent = await getSetting("commissionPercent");
  });

  afterEach(async () => {
    await backgroundIdle();
    fakeControls.failCreateOrder = false;
    fakeControls.failRefunds = 0;
  });

  afterAll(async () => {
    const venueIds = [onlineVenueId, venueAtVenueId];
    const bookingIds = (await prisma.booking.findMany({ where: { venueId: { in: venueIds } }, select: { id: true } })).map((b) => b.id);
    await prisma.ledgerEntry.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.payout.deleteMany({ where: { providerId: users.owner!.id } });
    await prisma.refund.deleteMany({ where: { payment: { bookingId: { in: bookingIds } } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.updateMany({ where: { venueId: { in: venueIds } }, data: { rescheduledFromId: null } });
    await prisma.booking.deleteMany({ where: { venueId: { in: venueIds } } });
    await prisma.timeSlot.deleteMany({ where: { venueId: { in: venueIds } } });
    await prisma.venue.deleteMany({ where: { id: { in: venueIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users).map((x) => x.id) } } });
    await prisma.auditLog.deleteMany({ where: { actorId: users.admin!.id } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((x) => x.id) } } });
    await prisma.$disconnect();
  });

  it("reports the payment configuration", async () => {
    const response = await request(app).get("/api/payments/config");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ enabled: true, gateway: "fake", holdMinutes: 10 });
  });

  it("leaves pay-at-venue bookings as requests for the owner", async () => {
    const response = await book("alice", hourFromNow(30), venueAtVenueId);
    expect(response.status).toBe(201);
    expect(response.body.booking.status).toBe("PENDING");
    expect(response.body.payment).toBeNull();
  });

  it("holds the time while the customer pays, then confirms on a verified payment", async () => {
    const start = hourFromNow(40);
    const created = await book("alice", start);
    expect(created.status).toBe(201);
    const { booking, payment } = created.body;
    expect(booking.status).toBe("AWAITING_PAYMENT");
    // Held for the payment window only.
    expect(new Date(booking.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000 + 5000);
    // The amount comes from the server's price, in paise.
    expect(payment).toMatchObject({ gateway: "fake", amountPaise: 60000, currency: "INR", bookingId: booking.id });

    // Nobody else can take the time meanwhile, and the owner can't "confirm" it.
    expect((await book("bob", start)).status).toBe(409);
    const confirm = await request(app).patch(`/api/bookings/${booking.id}/confirm`).set(users.owner!.auth);
    expect(confirm.status).toBe(409);

    // Asking again returns the same order.
    const again = await request(app).post(`/api/payments/bookings/${booking.id}/start`).set(users.alice!.auth);
    expect(again.body.payment.orderId).toBe(payment.orderId);

    // A forged checkout result is refused.
    const paidForReal = simulateCheckout(payment.orderId, "success");
    const forged = await request(app)
      .post("/api/payments/verify")
      .set(users.alice!.auth)
      .send({ orderId: payment.orderId, paymentId: paidForReal.paymentId, signature: "0".repeat(64) });
    expect(forged.status).toBe(400);

    const verified = await request(app)
      .post("/api/payments/verify")
      .set(users.alice!.auth)
      .send({ orderId: payment.orderId, paymentId: paidForReal.paymentId, signature: paidForReal.signature });
    expect(verified.status).toBe(200);
    expect(verified.body.booking.status).toBe("CONFIRMED");
    expect(verified.body.booking.expiresAt).toBeNull();

    const stored = await paymentOf(booking.id);
    expect(stored).toMatchObject({ status: "CAPTURED", method: "upi", gatewayPaymentId: paidForReal.paymentId });

    const sale = await prisma.ledgerEntry.findFirstOrThrow({ where: { paymentId: stored.id } });
    const commission = Math.round((60000 * commissionPercent) / 100);
    expect(sale).toMatchObject({ type: "SALE", grossPaise: 60000, commissionPaise: commission, providerSharePaise: 60000 - commission });

    // The webhook for the same payment, delivered twice, changes nothing.
    const first = await deliver(paidForReal.webhook);
    const second = await deliver(paidForReal.webhook);
    expect(first.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(await prisma.ledgerEntry.count({ where: { paymentId: stored.id } })).toBe(1);

    // Nothing more to pay.
    const start2 = await request(app).post(`/api/payments/bookings/${booking.id}/start`).set(users.alice!.auth);
    expect(start2.status).toBe(409);

    await backgroundIdle();
    const ownerNote = await prisma.notification.findFirst({ where: { userId: users.owner!.id, title: "New paid booking" } });
    expect(ownerNote).not.toBeNull();
  });

  it("confirms from the webhook alone when the browser never reports back", async () => {
    const created = await book("alice", hourFromNow(44));
    const paid = simulateCheckout(created.body.payment.orderId, "success");
    const response = await deliver(paid.webhook);
    expect(response.status).toBe(200);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: created.body.booking.id } });
    expect(booking.status).toBe("CONFIRMED");
  });

  it("rejects webhooks with a bad signature", async () => {
    const webhook = fakeWebhook("payment.captured", { payment: { id: "pay_x" } });
    const response = await deliver({ ...webhook, signature: "f".repeat(64) });
    expect(response.status).toBe(400);
    expect(await prisma.webhookEvent.findUnique({ where: { id: webhook.eventId } })).toBeNull();
  });

  it("keeps a failed attempt payable and never settles a mismatched amount", async () => {
    const created = await book("alice", hourFromNow(46));
    const orderId = created.body.payment.orderId;

    const failed = simulateCheckout(orderId, "failure");
    await deliver(failed.webhook);
    expect((await paymentOf(created.body.booking.id)).status).toBe("FAILED");

    // A payment reporting another amount than the order is ignored.
    const tampered = simulateCheckout(orderId, "success", 100);
    await deliver(tampered.webhook);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: created.body.booking.id } })).status).toBe("AWAITING_PAYMENT");

    // Retrying on the same order works.
    const { verified } = await payAndVerify("alice", orderId);
    expect(verified.body.booking.status).toBe("CONFIRMED");
  });

  it("revives a booking paid just after its hold ran out if the time is still free", async () => {
    const created = await book("alice", hourFromNow(50));
    const bookingId = created.body.booking.id;
    await prisma.booking.update({ where: { id: bookingId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expireOverdueBookings();
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("EXPIRED");
    await backgroundIdle();
    const lapsed = await prisma.notification.findFirst({ where: { userId: users.alice!.id, title: "Payment not completed" } });
    expect(lapsed).not.toBeNull();

    const { verified } = await payAndVerify("alice", created.body.payment.orderId);
    expect(verified.body.booking.status).toBe("CONFIRMED");
  });

  it("refunds a late payment in full when someone else took the time", async () => {
    const start = hourFromNow(52);
    const created = await book("alice", start);
    const bookingId = created.body.booking.id;
    await prisma.booking.update({ where: { id: bookingId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    // Bob books the released time (and pays).
    const bobs = await book("bob", start);
    expect(bobs.status).toBe(201);
    await payAndVerify("bob", bobs.body.payment.orderId);

    const { verified } = await payAndVerify("alice", created.body.payment.orderId);
    expect(verified.body.booking.status).toBe("EXPIRED");
    await backgroundIdle();

    const payment = await paymentOf(bookingId);
    expect(payment.status).toBe("REFUNDED");
    expect(payment.refunds).toEqual([expect.objectContaining({ amountPaise: 60000, status: "PROCESSED" })]);
    // Never a sale, so the provider's ledger doesn't see it.
    expect(await prisma.ledgerEntry.count({ where: { paymentId: payment.id } })).toBe(0);
  });

  it("refunds what the cancellation policy allows, once, and takes back the commission share", async () => {
    // 5 hours ahead: the 50% tier.
    const created = await book("alice", hourFromNow(5));
    const bookingId = created.body.booking.id;
    await payAndVerify("alice", created.body.payment.orderId);

    const quote = await request(app).get(`/api/bookings/${bookingId}/cancellation-quote`).set(users.alice!.auth);
    expect(quote.body.quote.refundPercent).toBe(50);

    const cancelled = await request(app).patch(`/api/bookings/${bookingId}/cancel`).set(users.alice!.auth);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.booking).toMatchObject({ status: "CANCELLED", refundPercent: 50 });
    await backgroundIdle();

    const payment = await paymentOf(bookingId);
    expect(payment).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedPaise: 30000 });
    expect(payment.refunds).toHaveLength(1);

    // Running the job again doesn't refund twice.
    await processRefund(payment.refunds[0]!.id);
    expect((await paymentOf(bookingId)).refundedPaise).toBe(30000);

    const refundEntry = await prisma.ledgerEntry.findFirstOrThrow({ where: { paymentId: payment.id, type: "REFUND" } });
    const saleCommission = Math.round((60000 * commissionPercent) / 100);
    expect(refundEntry.grossPaise).toBe(-30000);
    expect(refundEntry.commissionPaise).toBe(-Math.round(saleCommission / 2));

    const note = await prisma.notification.findFirst({
      where: { userId: users.alice!.id, type: "PAYMENT_REFUNDED" },
      orderBy: { createdAt: "desc" },
    });
    expect(note?.body).toContain("₹300");
  });

  it("refunds everything when the venue cancels, retrying if the gateway is down", async () => {
    const created = await book("alice", hourFromNow(60));
    const bookingId = created.body.booking.id;
    await payAndVerify("alice", created.body.payment.orderId);

    fakeControls.failRefunds = 1;
    const cancelled = await request(app).patch(`/api/bookings/${bookingId}/cancel`).set(users.owner!.auth);
    expect(cancelled.status).toBe(200);
    await backgroundIdle();

    let payment = await paymentOf(bookingId);
    expect(payment.refunds[0]).toMatchObject({ status: "PENDING", attempts: 1, amountPaise: 60000 });

    // The queue retries it.
    await processRefund(payment.refunds[0]!.id);
    payment = await paymentOf(bookingId);
    expect(payment).toMatchObject({ status: "REFUNDED", refundedPaise: 60000 });
  });

  it("drops the booking when the gateway can't create an order", async () => {
    const start = hourFromNow(64);
    fakeControls.failCreateOrder = true;
    const response = await book("alice", start);
    expect(response.status).toBe(503);
    fakeControls.failCreateOrder = false;

    // The time is free again.
    expect((await book("bob", start)).status).toBe(201);
  });

  it("finds payments nobody reported by asking the gateway", async () => {
    const created = await book("alice", hourFromNow(70));
    simulateCheckout(created.body.payment.orderId, "success");
    await prisma.payment.updateMany({
      where: { bookingId: created.body.booking.id },
      data: { updatedAt: new Date(Date.now() - 5 * 60_000) },
    });

    expect(await reconcilePayments()).toBeGreaterThanOrEqual(1);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: created.body.booking.id } })).status).toBe("CONFIRMED");
  });

  it("doesn't offer weekly series at pay-online venues", async () => {
    const response = await request(app)
      .post("/api/bookings/recurring")
      .set(users.alice!.auth)
      .send({ venueId: onlineVenueId, startTime: iso(hourFromNow(80)), durationMinutes: 60, weeks: 3 });
    expect(response.status).toBe(400);
  });

  it("shows the provider their earnings and lets an admin record a payout", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const earnings = await request(app)
      .get(`/api/provider/earnings?from=${today}&to=${tomorrow}`)
      .set(users.owner!.auth);
    expect(earnings.status).toBe(200);
    expect(earnings.body.unpaid.providerSharePaise).toBeGreaterThan(0);
    expect(earnings.body.entries.length).toBeGreaterThan(0);

    const summary = await request(app).get(`/api/admin/payments/summary?from=${today}&to=${tomorrow}`).set(users.admin!.auth);
    expect(summary.status).toBe(200);
    expect(summary.body.capturedPaise).toBeGreaterThan(0);
    expect(summary.body.issues.orphanPayments.filter((p: { booking: { id: string } }) => p.booking)).toBeDefined();

    const payout = await request(app)
      .post("/api/admin/payouts")
      .set(users.admin!.auth)
      .send({ providerId: users.owner!.id, reference: "NEFT-123" });
    expect(payout.status).toBe(201);
    expect(payout.body.payout.amountPaise).toBe(earnings.body.unpaid.providerSharePaise);

    const after = await request(app).get(`/api/provider/earnings?from=${today}&to=${tomorrow}`).set(users.owner!.auth);
    expect(after.body.unpaid.providerSharePaise).toBe(0);

    const again = await request(app).post("/api/admin/payouts").set(users.admin!.auth).send({ providerId: users.owner!.id });
    expect(again.status).toBe(409);
  });
});
