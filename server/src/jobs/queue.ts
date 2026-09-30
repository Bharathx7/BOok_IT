import { PgBoss, type SendOptions } from "pg-boss";

import { env } from "../config/env.js";
import { runInBackground } from "../utils/background.js";
import { logger } from "../utils/logger.js";
import { reportError } from "../utils/monitoring.js";

// Background jobs are stored in Postgres (pg-boss creates its own "pgboss"
// schema), so there is no Redis to run. Jobs survive restarts and are
// retried with backoff.

export const QUEUES = {
  /** Outgoing email, retried with exponential backoff. */
  email: "email",
  /** Every minute: expire, complete and remind bookings. */
  bookingMaintenance: "booking-maintenance",
  /** Nightly: keep slot templates filled 30 days ahead. */
  slotGeneration: "slot-generation",
  /** Refunds sent to the payment gateway, retried with backoff. */
  payments: "payments",
  /** Every minute: ask the gateway about payments nobody reported. */
  paymentReconcile: "payment-reconcile",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

type Handler = (data: object) => Promise<unknown>;

const handlers = new Map<QueueName, Handler>();
let boss: PgBoss | null = null;

/** Registers the function that processes jobs of a queue. */
export function registerHandler<T extends object>(name: QueueName, handler: (data: T) => Promise<unknown>) {
  handlers.set(name, handler as Handler);
}

/**
 * Adds a job. Before the queue is started (tests, one-off scripts) the job
 * runs right away in the background instead, so callers never need to care.
 */
export async function enqueue(name: QueueName, data: object, options?: SendOptions) {
  if (boss) {
    await boss.send(name, data, options ?? {});
    return;
  }

  const handler = handlers.get(name);

  if (handler) {
    runInBackground(`job:${name}`, () => handler(data));
  }
}

export async function startQueue() {
  const instance = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
    max: 4,
    application_name: "bookit-jobs",
  });

  instance.on("error", (error) => {
    logger.error({ err: error }, "Job queue error");
    reportError(error, { task: "job-queue" });
  });

  await instance.start();

  await ensureQueue(instance, QUEUES.email, {
    retryLimit: 6,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 60 * 60,
  });
  // A missed minute is simply covered by the next run, so no retries.
  await ensureQueue(instance, QUEUES.bookingMaintenance, {
    retryLimit: 0,
    expireInSeconds: 5 * 60,
  });

  // Money going back to customers: keep trying for about a day.
  await ensureQueue(instance, QUEUES.payments, {
    retryLimit: 12,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 2 * 60 * 60,
  });

  await ensureQueue(instance, QUEUES.paymentReconcile, {
    retryLimit: 0,
    expireInSeconds: 5 * 60,
  });

  await ensureQueue(instance, QUEUES.slotGeneration, {
    retryLimit: 2,
    retryDelay: 300,
    expireInSeconds: 30 * 60,
  });

  for (const [name, handler] of handlers) {
    await instance.work<object>(name, async (jobs) => {
      for (const job of jobs) {
        try {
          await handler(job.data);
        } catch (error) {
          // pg-boss retries it; the report says which job kept failing.
          reportError(error, { task: `job:${name}` });
          throw error;
        }
      }
    });
  }

  await instance.schedule(QUEUES.bookingMaintenance, "* * * * *");
  await instance.schedule(QUEUES.paymentReconcile, "* * * * *");
  // 00:15 UTC (05:45 IST), after the day has rolled over for Indian venues.
  await instance.schedule(QUEUES.slotGeneration, "15 0 * * *");

  boss = instance;
  logger.info("Job queue started");
}

async function ensureQueue(
  instance: PgBoss,
  name: QueueName,
  options: Parameters<PgBoss["createQueue"]>[1]
) {
  if (await instance.getQueue(name)) {
    await instance.updateQueue(name, options);
  } else {
    await instance.createQueue(name, options);
  }
}

export async function stopQueue() {
  const instance = boss;
  boss = null;

  if (instance) {
    await instance.stop({ graceful: true, timeout: 10_000 });
  }
}
