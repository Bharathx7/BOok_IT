import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";

import { env } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import venueRoutes from "./routes/venue.routes.js";
import emailRoutes from "./routes/email.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import {
  errorMiddleware,
  notFoundMiddleware,
} from "./middleware/error.middleware.js";
import { globalRateLimiter } from "./middleware/rateLimit.middleware.js";
import timeslotRoutes from "./routes/timeslot.routes.js";
import reviewRoutes from "./routes/review.routes.js";
import userRoutes from "./routes/user.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import venueToolsRoutes from "./routes/venueTools.routes.js";
import providerRoutes from "./routes/provider.routes.js";
import bookingFeaturesRoutes from "./routes/bookingFeatures.routes.js";
import couponRoutes from "./routes/coupon.routes.js";
import paymentRoutes, { webhookRouter } from "./routes/payment.routes.js";
import { auditContext } from "./services/audit.service.js";
import { swaggerSpec } from "./config/swagger.js";
import { logger } from "./utils/logger.js";
import { LOCAL_UPLOADS_ROUTE, uploadsDir } from "./storage/index.js";

export const API_VERSION = "v1";

const app = express();

app.set("trust proxy", env.TRUST_PROXY);

app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers["x-request-id"];
      const id =
        typeof incoming === "string" && incoming.length <= 128
          ? incoming
          : randomUUID();

      res.setHeader("x-request-id", id);
      return id;
    },
    autoLogging: {
      ignore: (req) => req.url === "/health",
    },
    // One line per request. Full headers were noisy and leaked the refresh
    // token through the response's set-cookie header.
    serializers: {
      req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, error) =>
      error || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
    customSuccessMessage: (req, res, responseTime) =>
      `${req.method} ${req.url} ${res.statusCode} ${Math.round(responseTime)}ms`,
    customErrorMessage: (req, res, error) => `${req.method} ${req.url} ${res.statusCode} ${error.message}`,
  })
);

app.use(helmet());
app.use(
  cors({
    origin: env.CLIENT_ORIGINS,
    credentials: true,
    exposedHeaders: ["x-request-id"],
  })
);
// Payment webhooks need the raw body (the signature covers the exact bytes),
// so they're routed before the JSON parser.
app.use([`/api/${API_VERSION}/payments/webhook`, "/api/payments/webhook"], webhookRouter);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    message: "BookIt API is running",
  });
});

// Swagger
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Locally stored venue photos (development). Production uses Supabase Storage.
if (env.STORAGE_DRIVER === "local") {
  app.use(
    LOCAL_UPLOADS_ROUTE,
    express.static(uploadsDir, { maxAge: "7d", immutable: true, fallthrough: false })
  );
}

// Every endpoint lives under /api/v1. The unversioned /api prefix is kept as
// a deprecated alias for older clients and deployments.
const api = express.Router();

api.use(globalRateLimiter);
// After body parsing: remembers the caller's IP and user agent for audit entries.
api.use(auditContext);
api.use("/auth", authRoutes);
api.use("/users", userRoutes);
api.use("/notifications", notificationRoutes);
// Rescheduling, series, invites, check-in, waitlist (specific paths, before the generic ones).
api.use("/", bookingFeaturesRoutes);
// Venue scheduling/pricing tools first: /venues/:id/schedule, /templates, ...
api.use("/venues/:id", venueToolsRoutes);
api.use("/venues", venueRoutes);
api.use("/provider", providerRoutes);
api.use("/email", emailRoutes);
api.use("/admin", adminRoutes);
api.use("/coupons", couponRoutes);
api.use("/payments", paymentRoutes);
api.use("/bookings", bookingRoutes);
api.use("/timeslots", timeslotRoutes);
api.use("/reviews", reviewRoutes);

// Unknown /api/v1 paths end here instead of falling through to the alias.
app.use(`/api/${API_VERSION}`, api, notFoundMiddleware);
app.use(
  "/api",
  (req, res, next) => {
    res.setHeader("Deprecation", "true");
    res.setHeader("Link", `</api/${API_VERSION}${req.path}>; rel="successor-version"`);
    next();
  },
  api
);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
