import { jest } from "@jest/globals";

// Limits are read from env when the app module loads, so shrink them first.
// Jest gives each test file its own process.env, so other suites are unaffected.
const GLOBAL_LIMIT = 8;
const AUTH_LIMIT = 3;
process.env.RATE_LIMIT_MAX = String(GLOBAL_LIMIT);
process.env.AUTH_RATE_LIMIT_MAX = String(AUTH_LIMIT);

const { default: request } = await import("supertest");
const { default: app } = await import("../src/app.js");
const { default: prisma } = await import("../src/config/prisma.js");

jest.setTimeout(20000);

// Supertest sends every request from the same IP, and the limiter's memory
// store lives as long as the app module, so request order matters here:
// requests made in earlier tests count towards the global limit later.
describe("Rate limiting", () => {
  const badLogin = () =>
    request(app).post("/api/auth/login").send({
      email: `nobody-${Date.now()}@example.com`,
      password: "wrong-password",
    });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("blocks auth requests after the auth limit and reports it in headers", async () => {
    for (let attempt = 1; attempt <= AUTH_LIMIT; attempt++) {
      const response = await badLogin();
      expect(response.status).toBe(401);
      expect(response.headers).toHaveProperty("ratelimit");
    }

    const blocked = await badLogin();

    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toBe(
      "Too many authentication attempts, please try again later"
    );
    expect(blocked.headers).toHaveProperty("retry-after");
  });

  it("keeps other API routes available when only the auth limit is hit", async () => {
    const response = await request(app).get("/api/venues");

    expect(response.status).toBe(200);
  });

  it("blocks all API routes after the global limit", async () => {
    // AUTH_LIMIT + 1 auth requests and 1 venue request have been made so far.
    const used = AUTH_LIMIT + 2;

    for (let i = used; i < GLOBAL_LIMIT; i++) {
      const response = await request(app).get("/api/venues");
      expect(response.status).toBe(200);
    }

    const blocked = await request(app).get("/api/venues");

    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toBe("Too many requests, please try again later");
  });
});
