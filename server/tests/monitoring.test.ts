import { jest } from "@jest/globals";
import express from "express";

// A fake Sentry, so nothing leaves the machine.
const captureException = jest.fn();
const scope = { setTag: jest.fn(), setUser: jest.fn() };
const init = jest.fn();

jest.unstable_mockModule("@sentry/node", () => ({
  init,
  captureException,
  withScope: (callback: (s: typeof scope) => void) => callback(scope),
  close: jest.fn(() => Promise.resolve(true)),
}));

process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";

const { default: request } = await import("supertest");
const { initMonitoring } = await import("../src/utils/monitoring.js");
const { errorMiddleware } = await import("../src/middleware/error.middleware.js");
const { NotFoundError } = await import("../src/utils/errors.js");
const { runInBackground, backgroundIdle } = await import("../src/utils/background.js");

afterAll(() => {
  delete process.env.SENTRY_DSN;
});

describe("error monitoring", () => {
  const app = express();
  app.get("/boom", () => {
    throw new Error("database exploded");
  });
  app.get("/missing", () => {
    throw new NotFoundError("Venue not found");
  });
  app.use(errorMiddleware);

  let initOptions: unknown;
  beforeAll(() => {
    initMonitoring();
    initOptions = init.mock.calls[0]?.[0];
  });
  beforeEach(() => jest.clearAllMocks());

  it("reports unexpected server errors with the route, but not their details to the client", async () => {
    expect(initOptions).toMatchObject({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0 });

    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Internal server error");
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "database exploded" }));
    expect(scope.setTag).toHaveBeenCalledWith("route", "GET /boom");
  });

  it("leaves expected errors (4xx) out", async () => {
    expect((await request(app).get("/missing")).status).toBe(404);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports failed background tasks", async () => {
    runInBackground("send receipt", async () => {
      throw new Error("smtp down");
    });
    await backgroundIdle();
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "smtp down" }));
    expect(scope.setTag).toHaveBeenCalledWith("task", "send receipt");
  });
});
