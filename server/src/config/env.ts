import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .optional(),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 characters"),
    JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
    // Refresh tokens are random opaque values stored (hashed) in the database,
    // so JWT_REFRESH_SECRET / JWT_REFRESH_EXPIRES_IN are no longer used.
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

    // Comma-separated list of allowed browser origins, e.g.
    // "https://bookit.vercel.app,http://localhost:5173"
    CLIENT_URL: z.string().optional(),

    // Public frontend URL used in email links (verify email, reset password).
    // Defaults to the first CLIENT_URL entry, or the Vite dev server.
    APP_URL: z.url().optional(),

    // Number of reverse proxies in front of the API (Render, Railway, Nginx...).
    // Needed so rate limiting sees the real client IP.
    TRUST_PROXY: z.coerce.number().int().min(0).optional(),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

    EMAIL_USER: z.string().optional(),
    EMAIL_PASS: z.string().optional(),

    // Where uploaded images go. "local" writes to UPLOADS_DIR (development);
    // production must use "supabase" because Render's disk is wiped on deploy.
    STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
    UPLOADS_DIR: z.string().default("uploads"),
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SERVICE_KEY: z.string().optional(),
    SUPABASE_BUCKET: z.string().default("venue-images"),

    // Development only: deliver every outgoing email to this address instead
    // of the real recipient (who is named in the subject).
    EMAIL_REDIRECT_TO: z.email().optional(),

    // Online payments. "none" hides the pay-online option; "fake" simulates a
    // gateway for development and tests (refused in production); "razorpay"
    // needs the key pair and the webhook secret from the Razorpay dashboard
    // (test keys start with rzp_test_).
    PAYMENT_GATEWAY: z.enum(["none", "fake", "razorpay"]).default("none"),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    // How long an unpaid online booking holds its time.
    PAYMENT_HOLD_MINUTES: z.coerce.number().int().min(2).max(60).default(10),

    // Error tracking (optional). Without a DSN nothing is sent.
    SENTRY_DSN: z.url().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    SENTRY_RELEASE: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === "production" && !value.CLIENT_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["CLIENT_URL"],
        message: "CLIENT_URL is required in production",
      });
    }

    if (value.STORAGE_DRIVER === "supabase" && (!value.SUPABASE_URL || !value.SUPABASE_SERVICE_KEY)) {
      ctx.addIssue({
        code: "custom",
        path: ["SUPABASE_URL"],
        message: "SUPABASE_URL and SUPABASE_SERVICE_KEY are required when STORAGE_DRIVER=supabase",
      });
    }

    if (value.NODE_ENV === "production" && value.STORAGE_DRIVER === "local") {
      ctx.addIssue({
        code: "custom",
        path: ["STORAGE_DRIVER"],
        message: "Local image storage is lost on redeploy; set STORAGE_DRIVER=supabase in production",
      });
    }

    if (
      value.PAYMENT_GATEWAY === "razorpay" &&
      (!value.RAZORPAY_KEY_ID || !value.RAZORPAY_KEY_SECRET || !value.RAZORPAY_WEBHOOK_SECRET)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["RAZORPAY_KEY_ID"],
        message: "RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET are required when PAYMENT_GATEWAY=razorpay",
      });
    }

    if (value.NODE_ENV === "production" && value.PAYMENT_GATEWAY === "fake") {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_GATEWAY"],
        message: "The fake payment gateway takes no real money; use razorpay (or none) in production",
      });
    }

    if (value.NODE_ENV === "production" && value.EMAIL_REDIRECT_TO) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_REDIRECT_TO"],
        message: "EMAIL_REDIRECT_TO must not be set in production",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

  // Logger depends on env, so plain console is used here.
  console.error(`Invalid environment configuration:\n${details}`);
  process.exit(1);
}

const data = parsed.data;

// Outside production, allow the Vite dev server on any local port (it moves
// to 5174, 5175... when 5173 is taken).
const defaultOrigins: (string | RegExp)[] =
  data.NODE_ENV === "production"
    ? []
    : [/^http:\/\/(localhost|127\.0\.0\.1):\d+$/];

const clientUrls = data.CLIENT_URL
  ? data.CLIENT_URL.split(",").map((origin) => origin.trim()).filter(Boolean)
  : [];

export const env = {
  ...data,
  APP_URL: (data.APP_URL ?? clientUrls[0] ?? "http://localhost:5173").replace(/\/+$/, ""),
  LOG_LEVEL:
    data.LOG_LEVEL ?? (data.NODE_ENV === "test" ? "silent" : "info"),
  TRUST_PROXY: data.TRUST_PROXY ?? (data.NODE_ENV === "production" ? 1 : 0),
  CLIENT_ORIGINS: clientUrls.length > 0 ? (clientUrls as (string | RegExp)[]) : defaultOrigins,
  EMAIL_ENABLED: Boolean(data.EMAIL_USER && data.EMAIL_PASS),
};
