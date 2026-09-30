import * as Sentry from "@sentry/node";

import { env } from "../config/env.js";

// Error tracking with Sentry. Does nothing unless SENTRY_DSN is set, so
// development and tests never send anything. Only unexpected failures are
// reported (5xx responses, failed background work and jobs); expected 4xx
// errors stay in the logs.

let enabled = false;

export function initMonitoring() {
  if (!env.SENTRY_DSN || enabled) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    // Errors only, no performance tracing. Personal data is off by default.
    tracesSampleRate: 0,
  });
  enabled = true;
}

export interface ErrorContext {
  requestId?: string | undefined;
  userId?: string | undefined;
  route?: string | undefined;
  task?: string | undefined;
  /** Record ids and similar (no personal data). */
  extra?: Record<string, string | number | null | undefined> | undefined;
}

export function reportError(error: unknown, context: ErrorContext = {}) {
  if (!enabled) return;

  Sentry.withScope((scope) => {
    if (context.requestId) scope.setTag("request_id", context.requestId);
    if (context.route) scope.setTag("route", context.route);
    if (context.task) scope.setTag("task", context.task);
    if (context.extra) scope.setExtras(context.extra);
    // The id only (no email), enough to look the account up in the admin pages.
    if (context.userId) scope.setUser({ id: context.userId });
    Sentry.captureException(error);
  });
}

/** Sends anything still queued; call before the process exits. */
export async function flushMonitoring() {
  if (enabled) await Sentry.close(2000);
}
