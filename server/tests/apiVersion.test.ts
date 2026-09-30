import request from "supertest";
import app from "../src/app.js";
import prisma from "../src/config/prisma.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("API versioning", () => {
  it("serves endpoints under /api/v1 without a deprecation notice", async () => {
    const res = await request(app).get("/api/v1/venues/popular");
    expect(res.status).toBe(200);
    expect(res.headers.deprecation).toBeUndefined();
  });

  it("keeps the old /api prefix working, marked as deprecated", async () => {
    const res = await request(app).get("/api/venues/popular");
    expect(res.status).toBe(200);
    expect(res.headers.deprecation).toBe("true");
    expect(res.headers.link).toBe('</api/v1/venues/popular>; rel="successor-version"');
  });

  it("404s unknown versioned paths", async () => {
    const res = await request(app).get("/api/v1/nope");
    expect(res.status).toBe(404);
  });

  it("documents every route in the OpenAPI spec under the v1 server", async () => {
    const { swaggerSpec } = await import("../src/config/swagger.js");
    const spec = swaggerSpec as { servers: { url: string }[]; paths: Record<string, unknown> };
    expect(spec.servers[0]!.url).toBe("/api/v1");
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(["/bookings", "/admin/settings", "/timeslots"]));
    expect(Object.keys(spec.paths).some((path) => path.startsWith("/api/"))).toBe(false);
  });
});
