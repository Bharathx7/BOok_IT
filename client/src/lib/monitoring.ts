// Error tracking with Sentry, only when VITE_SENTRY_DSN is set. The SDK is
// loaded on demand, so builds without a DSN don't download it at all.

type Reporter = (error: unknown, context?: Record<string, string>) => void;

let reporter: Reporter | null = null;

export async function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn || reporter) return;

  const Sentry = await import("@sentry/react");
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
    // Errors only, no performance tracing. Uncaught errors and rejections are reported automatically.
    tracesSampleRate: 0,
  });

  reporter = (error, context) =>
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(context ?? {})) scope.setTag(key, value);
      Sentry.captureException(error);
    });
}

/** Reports an error that the app caught itself (e.g. a crashed page). */
export function reportError(error: unknown, context?: Record<string, string>) {
  reporter?.(error, context);
}
