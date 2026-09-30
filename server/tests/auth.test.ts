import { jest } from "@jest/globals";

// Capture outgoing account emails so tests can follow the links in them.
type LinkEmail = { to: string; userName: string; link: string };

const sendVerificationEmail = jest.fn<(details: LinkEmail) => Promise<void>>(() =>
  Promise.resolve()
);
const sendPasswordResetEmail = jest.fn<(details: LinkEmail) => Promise<void>>(() =>
  Promise.resolve()
);
const sendPasswordChangedEmail = jest.fn(() => Promise.resolve());

jest.unstable_mockModule("../src/services/email.service.js", () => ({
  queueEmail: jest.fn(() => Promise.resolve()),
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendBookingConfirmationEmail: jest.fn(() => Promise.resolve()),
  sendBookingCancellationEmail: jest.fn(() => Promise.resolve()),
  sendBookingReminderEmail: jest.fn(() => Promise.resolve()),
  sendTestEmail: jest.fn(() => Promise.resolve()),
}));

jest.unstable_mockModule("../src/sockets/socket.js", () => ({
  emitNotification: jest.fn(),
  emitBookingEvent: jest.fn(),
  initializeSocket: jest.fn(),
}));

const { default: request } = await import("supertest");
const { default: app } = await import("../src/app.js");
const { default: prisma } = await import("../src/config/prisma.js");

jest.setTimeout(30000);

const PASSWORD = "Test@12345";
const COOKIE_NAME = "bookit_rt";

let counter = 0;
const uniqueEmail = (label: string) => `${label}-${Date.now()}-${counter++}@example.com`;

/** Background emails are fired without awaiting; let them run. */
const flushBackground = () => new Promise((resolve) => setImmediate(resolve));

/** Returns "bookit_rt=<value>" from a response, or undefined. */
const refreshCookieOf = (response: { headers: Record<string, unknown> }) => {
  const header = response.headers["set-cookie"];
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  const cookie = cookies.find((value) => value.startsWith(`${COOKIE_NAME}=`));
  const pair = cookie?.split(";")[0];
  return pair && pair !== `${COOKIE_NAME}=` ? pair : undefined;
};

const tokenFromLink = (link: string) => new URL(link).searchParams.get("token")!;

const register = (email: string, name = "Test User") =>
  request(app).post("/api/auth/register").send({ name, email, password: PASSWORD });

const login = (email: string, password = PASSWORD) =>
  request(app).post("/api/auth/login").send({ email, password });

const refresh = (cookie?: string) => {
  const req = request(app).post("/api/auth/refresh");
  return cookie ? req.set("Cookie", cookie) : req;
};

const me = (accessToken: string) =>
  request(app).get("/api/users/me").set("Authorization", `Bearer ${accessToken}`);

/** Registers, verifies and signs in a user. */
async function signedInUser(label: string) {
  const email = uniqueEmail(label);
  await register(email);
  await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  const response = await login(email);
  return {
    email,
    userId: response.body.user.id as string,
    accessToken: response.body.accessToken as string,
    cookie: refreshCookieOf(response)!,
  };
}

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Registration and login", () => {
  it("rejects registration with missing fields", async () => {
    const response = await request(app).post("/api/auth/register").send({});

    expect(response.status).toBe(400);
  });

  it("rejects a duplicate email", async () => {
    const email = uniqueEmail("duplicate");
    await register(email);

    const response = await register(email);

    expect(response.status).toBe(409);
    expect(response.body.message).toBe("User already exists");
  });

  it("registers an unverified user and emails a verification link", async () => {
    const email = uniqueEmail("new");

    const response = await register(email, "New Test User");
    await flushBackground();

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      name: "New Test User",
      email,
      role: "USER",
      status: "ACTIVE",
      emailVerified: false,
    });
    expect(response.body.user).not.toHaveProperty("passwordHash");

    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    const [details] = sendVerificationEmail.mock.calls[0]!;
    expect(details.to).toBe(email);
    expect(details.link).toMatch(/\/verify-email\?token=/);
  });

  it("returns an access token and sets the refresh token only as an httpOnly cookie", async () => {
    const email = uniqueEmail("login");
    await register(email);

    const response = await login(email);

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(email);
    expect(response.body).toHaveProperty("accessToken");
    expect(response.body).not.toHaveProperty("refreshToken");

    const setCookie = (response.headers["set-cookie"] as unknown as string[]).join(";");
    expect(setCookie).toMatch(new RegExp(`${COOKIE_NAME}=`));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/api;/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const lastLogin = await prisma.user.findUnique({ where: { email } });
    expect(lastLogin?.lastLoginAt).toBeInstanceOf(Date);
  });

  it("rejects a wrong password and an unknown email with the same message", async () => {
    const email = uniqueEmail("wrong-password");
    await register(email);

    const wrongPassword = await login(email, "WrongPassword@123");
    const unknownEmail = await login(uniqueEmail("nobody"));

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.message).toBe("Invalid email or password");
    expect(unknownEmail.body.message).toBe("Invalid email or password");
  });
});

describe("Sessions (refresh token rotation)", () => {
  it("answers refresh without a cookie with no session", async () => {
    const response = await refresh();

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});
  });

  it("rejects refresh with an unknown cookie", async () => {
    const response = await refresh("bookit_rt=not-a-real-token");

    expect(response.status).toBe(401);
  });

  it("rotates the refresh token and returns a working access token", async () => {
    const user = await signedInUser("rotate");

    const response = await refresh(user.cookie);

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(user.userId);
    const newCookie = refreshCookieOf(response);
    expect(newCookie).toBeDefined();
    expect(newCookie).not.toBe(user.cookie);

    const profile = await me(response.body.accessToken);
    expect(profile.status).toBe(200);
    expect(profile.body.user.email).toBe(user.email);

    // The new token works for the next refresh too.
    expect((await refresh(newCookie)).status).toBe(200);
  });

  it("treats a quickly repeated refresh (two tabs) as a race, not theft", async () => {
    const user = await signedInUser("two-tabs");

    const first = await refresh(user.cookie);
    const second = await refresh(user.cookie);

    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
    // The session from the first refresh is still alive.
    expect((await refresh(refreshCookieOf(first))).status).toBe(200);
  });

  it("revokes the whole session when an old refresh token is replayed later", async () => {
    const user = await signedInUser("reuse");

    const rotated = await refresh(user.cookie);
    const currentCookie = refreshCookieOf(rotated)!;

    // Pretend the original token was rotated a minute ago, then replay it.
    await prisma.refreshToken.updateMany({
      where: { userId: user.userId, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    const replay = await refresh(user.cookie);
    expect(replay.status).toBe(401);

    // The legitimate, newest token is now dead as well.
    expect((await refresh(currentCookie)).status).toBe(401);
  });

  it("logout revokes this device's session and clears the cookie", async () => {
    const user = await signedInUser("logout");

    const response = await request(app).post("/api/auth/logout").set("Cookie", user.cookie);

    expect(response.status).toBe(204);
    expect((response.headers["set-cookie"] as unknown as string[]).join(";")).toMatch(
      new RegExp(`${COOKIE_NAME}=;`)
    );
    expect((await refresh(user.cookie)).status).toBe(401);
  });

  it("logout-all revokes every device", async () => {
    const user = await signedInUser("logout-all");
    const otherDevice = refreshCookieOf(await login(user.email))!;

    const response = await request(app)
      .post("/api/auth/logout-all")
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(response.status).toBe(204);
    expect((await refresh(user.cookie)).status).toBe(401);
    expect((await refresh(otherDevice)).status).toBe(401);
  });

  it("expired refresh tokens are rejected", async () => {
    const user = await signedInUser("expired");
    await prisma.refreshToken.updateMany({
      where: { userId: user.userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await refresh(user.cookie)).status).toBe(401);
  });
});

describe("Suspended and banned accounts", () => {
  it("blocks login, API access and refresh for a suspended user", async () => {
    const user = await signedInUser("suspended");
    await prisma.user.update({ where: { id: user.userId }, data: { status: "SUSPENDED" } });

    const loginResponse = await login(user.email);
    expect(loginResponse.status).toBe(403);
    expect(loginResponse.body.message).toMatch(/suspended/i);

    // The still-valid access token stops working immediately.
    expect((await me(user.accessToken)).status).toBe(403);
    expect((await refresh(user.cookie)).status).toBe(403);

    // Sessions stay revoked even after reactivation.
    await prisma.user.update({ where: { id: user.userId }, data: { status: "ACTIVE" } });
    expect((await refresh(user.cookie)).status).toBe(401);
  });

  it("blocks login for a banned user", async () => {
    const email = uniqueEmail("banned");
    await register(email);
    await prisma.user.update({ where: { email }, data: { status: "BANNED" } });

    const response = await login(email);

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/banned/i);
  });
});

describe("Email verification", () => {
  it("unverified users can sign in but cannot book until they verify", async () => {
    const email = uniqueEmail("verify");
    await register(email);
    await flushBackground();
    const link = sendVerificationEmail.mock.calls[0]![0].link;

    const { accessToken } = (await login(email)).body;
    const booking = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        venueId: "00000000-0000-0000-0000-000000000000",
        startTime: new Date(Date.now() + 86_400_000).toISOString(),
        endTime: new Date(Date.now() + 90_000_000).toISOString(),
      });
    expect(booking.status).toBe(403);
    expect(booking.body.code).toBe("EMAIL_NOT_VERIFIED");

    const verify = await request(app)
      .post("/api/auth/verify-email")
      .send({ token: tokenFromLink(link) });
    expect(verify.status).toBe(200);
    expect(verify.body.user.emailVerified).toBe(true);

    // Same access token, now allowed past the verification check (the fake
    // venue then 404s instead of 403).
    const retry = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        venueId: "00000000-0000-0000-0000-000000000000",
        startTime: new Date(Date.now() + 86_400_000).toISOString(),
        endTime: new Date(Date.now() + 90_000_000).toISOString(),
      });
    expect(retry.status).not.toBe(403);
  });

  it("verification links work once", async () => {
    const email = uniqueEmail("verify-once");
    await register(email);
    await flushBackground();
    const token = tokenFromLink(sendVerificationEmail.mock.calls[0]![0].link);

    expect((await request(app).post("/api/auth/verify-email").send({ token })).status).toBe(200);

    const second = await request(app).post("/api/auth/verify-email").send({ token });
    expect(second.status).toBe(400);
    expect(second.body.message).toBe("This link is invalid or has expired");
  });

  it("rejects an expired verification link", async () => {
    const email = uniqueEmail("verify-expired");
    await register(email);
    await flushBackground();
    const token = tokenFromLink(sendVerificationEmail.mock.calls[0]![0].link);
    await prisma.verificationToken.updateMany({
      where: { user: { email } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await request(app).post("/api/auth/verify-email").send({ token })).status).toBe(400);
  });

  it("resending replaces the previous link", async () => {
    const email = uniqueEmail("resend");
    await register(email);
    await flushBackground();
    const firstToken = tokenFromLink(sendVerificationEmail.mock.calls[0]![0].link);
    const { accessToken } = (await login(email)).body;

    const resend = await request(app)
      .post("/api/auth/resend-verification")
      .set("Authorization", `Bearer ${accessToken}`);
    await flushBackground();

    expect(resend.status).toBe(200);
    const secondToken = tokenFromLink(sendVerificationEmail.mock.calls[1]![0].link);
    expect((await request(app).post("/api/auth/verify-email").send({ token: firstToken })).status).toBe(400);
    expect((await request(app).post("/api/auth/verify-email").send({ token: secondToken })).status).toBe(200);

    const again = await request(app)
      .post("/api/auth/resend-verification")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(again.status).toBe(409);
  });
});

describe("Password reset", () => {
  it("gives the same answer for unknown emails and sends nothing", async () => {
    const response = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: uniqueEmail("nobody") });
    await flushBackground();

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/if an account exists/i);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("resets the password with the emailed link and signs out every device", async () => {
    const user = await signedInUser("reset");

    const forgot = await request(app).post("/api/auth/forgot-password").send({ email: user.email });
    await flushBackground();
    expect(forgot.status).toBe(200);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const token = tokenFromLink(sendPasswordResetEmail.mock.calls[0]![0].link);

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "BrandNew@123" });
    await flushBackground();

    expect(reset.status).toBe(200);
    expect(sendPasswordChangedEmail).toHaveBeenCalledTimes(1);
    expect((await login(user.email)).status).toBe(401);
    expect((await login(user.email, "BrandNew@123")).status).toBe(200);
    expect((await refresh(user.cookie)).status).toBe(401);

    const reuse = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "Another@123" });
    expect(reuse.status).toBe(400);
  });

  it("rejects a weak new password", async () => {
    const response = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "anything", password: "short" });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "password" })])
    );
  });
});

describe("Account profile and password change", () => {
  it("returns and updates the profile", async () => {
    const user = await signedInUser("profile");

    const update = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({
        name: "Renamed User",
        phone: "+91 98765 43210",
        avatarUrl: "https://example.com/me.png",
      });

    expect(update.status).toBe(200);
    expect(update.body.user).toMatchObject({
      name: "Renamed User",
      phone: "+91 98765 43210",
      avatarUrl: "https://example.com/me.png",
    });

    const clear = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({ phone: "", avatarUrl: "" });

    expect(clear.status).toBe(200);
    expect(clear.body.user.phone).toBeNull();
    expect(clear.body.user.avatarUrl).toBeNull();
    expect(clear.body.user.name).toBe("Renamed User");
  });

  it("rejects invalid profile fields and fields that can't be changed here", async () => {
    const user = await signedInUser("profile-invalid");

    const badPhone = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({ phone: "call me" });
    const roleChange = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({ role: "ADMIN" });

    expect(badPhone.status).toBe(400);
    expect(roleChange.status).toBe(400);
    expect((await me(user.accessToken)).body.user.role).toBe("USER");
  });

  it("changes the password, keeps this device signed in and signs out the others", async () => {
    const user = await signedInUser("change-password");
    const otherDevice = refreshCookieOf(await login(user.email))!;

    const wrong = await request(app)
      .post("/api/users/me/password")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({ currentPassword: "Wrong@12345", newPassword: "Changed@123" });
    expect(wrong.status).toBe(400);

    const response = await request(app)
      .post("/api/users/me/password")
      .set("Authorization", `Bearer ${user.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: "Changed@123" });

    expect(response.status).toBe(200);
    const thisDevice = refreshCookieOf(response)!;
    expect((await refresh(thisDevice)).status).toBe(200);
    expect((await refresh(otherDevice)).status).toBe(401);
    expect((await login(user.email, "Changed@123")).status).toBe(200);
  });
});
