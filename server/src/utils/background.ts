import { logger } from "./logger.js";
import { reportError } from "./monitoring.js";

const pending = new Set<Promise<unknown>>();

/**
 * Runs a side effect (email, notification...) without blocking the request
 * and without letting its failure fail the request. Durable work (emails,
 * reminders) goes through the job queue; this is for the quick follow-ups.
 */
export const runInBackground = (
  label: string,
  task: () => Promise<unknown>
) => {
  const run = Promise.resolve()
    .then(task)
    .catch((error: unknown) => {
      logger.error({ err: error, task: label }, "Background task failed");
      reportError(error, { task: label });
    })
    .finally(() => pending.delete(run));
  pending.add(run);
};

/**
 * Resolves once every background task has finished, including ones those
 * tasks start. For tests (instead of guessing how long to wait) and for a
 * clean shutdown.
 */
export async function backgroundIdle() {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}
