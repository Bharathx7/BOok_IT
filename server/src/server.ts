import { env } from "./config/env.js";
import { flushMonitoring, initMonitoring } from "./utils/monitoring.js";

// First, so errors during startup are reported too.
initMonitoring();
import { createServer } from "http";
import { Server } from "socket.io";
import app from "./app.js";
import prisma from "./config/prisma.js";
import { startQueue, stopQueue } from "./jobs/queue.js";
// Registers the job handlers (email sending, booking maintenance).
import "./services/email.service.js";
import "./services/bookingLifecycle.service.js";
import "./services/venueTools.service.js";
import "./services/payment.service.js";
import { initializeSocket } from "./sockets/socket.js";
import { logger } from "./utils/logger.js";

const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: env.CLIENT_ORIGINS,
    credentials: true,
  },
});

initializeSocket(io);

server.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT}`);

  startQueue().catch((error: unknown) => {
    // The API keeps working; emails and booking maintenance wait until restart.
    logger.error({ err: error }, "Job queue failed to start");
  });
});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);

  server.close();
  await io.close();
  await stopQueue().catch((error: unknown) => logger.error({ err: error }, "Job queue stop failed"));
  await prisma.$disconnect();
  await flushMonitoring();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
