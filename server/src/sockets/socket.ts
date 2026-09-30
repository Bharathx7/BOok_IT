import type { Server, Socket } from "socket.io";
import { z } from "zod";

import { verifyAccessToken } from "../utils/jwt.js";
import { logger } from "../utils/logger.js";

let io: Server;

export interface SocketUser {
  id: string;
  email: string;
  role: string;
}

export const rooms = {
  user: (userId: string) => `user:${userId}`,
  venue: (venueId: string) => `venue:${venueId}`,
  admin: "admin",
} as const;

const venueIdSchema = z.string().uuid();

/**
 * Sockets may connect anonymously (to follow public venue availability) or
 * with `auth: { token }` to receive their own booking events.
 * An invalid token is rejected rather than silently downgraded.
 */
const authenticateSocket = (socket: Socket, next: (error?: Error) => void) => {
  const token = socket.handshake.auth?.token;

  if (token === undefined || token === null || token === "") {
    return next();
  }

  if (typeof token !== "string") {
    return next(new Error("Invalid token"));
  }

  try {
    const decoded = verifyAccessToken(token);
    socket.data.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    } satisfies SocketUser;
    return next();
  } catch {
    return next(new Error("Invalid or expired token"));
  }
};

const registerHandlers = (socket: Socket) => {
  const user = socket.data.user as SocketUser | undefined;

  if (user) {
    void socket.join(rooms.user(user.id));

    if (user.role === "ADMIN") {
      void socket.join(rooms.admin);
    }
  }

  socket.on("venue:join", (venueId: unknown) => {
    if (venueIdSchema.safeParse(venueId).success) {
      void socket.join(rooms.venue(venueId as string));
    }
  });

  socket.on("venue:leave", (venueId: unknown) => {
    if (typeof venueId === "string") {
      void socket.leave(rooms.venue(venueId));
    }
  });

  socket.on("disconnect", () => {
    logger.debug({ socketId: socket.id }, "Socket disconnected");
  });
};

export const initializeSocket = (socketServer: Server) => {
  io = socketServer;

  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    logger.debug(
      { socketId: socket.id, userId: socket.data.user?.id },
      "Socket connected"
    );
    registerHandlers(socket);
  });
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io has not been initialized");
  }

  return io;
};

/** Pushes a new in-app notification to all of the user's open tabs. */
export const emitNotification = (userId: string, notification: object) => {
  getIO().to(rooms.user(userId)).emit("notification", notification);
};

export type BookingEvent =
  | "bookingCreated"
  | "bookingConfirmed"
  | "bookingCancelled"
  | "bookingCompleted"
  | "bookingExpired";

interface BookingEventSubject {
  id: string;
  userId: string;
  venueId: string;
  status: string;
  startTime: Date;
  endTime: Date;
}

/**
 * Sends a booking event only to the people involved: the customer, the venue
 * owner and admins. Viewers of the venue page get an anonymous availability
 * ping without any personal data.
 */
export const emitBookingEvent = (
  event: BookingEvent,
  booking: BookingEventSubject,
  venueOwnerId: string
) => {
  const server = getIO();

  server
    .to(rooms.user(booking.userId))
    .to(rooms.user(venueOwnerId))
    .to(rooms.admin)
    .emit(event, {
      bookingId: booking.id,
      userId: booking.userId,
      venueId: booking.venueId,
      status: booking.status,
    });

  server.to(rooms.venue(booking.venueId)).emit("venueAvailabilityChanged", {
    venueId: booking.venueId,
    startTime: booking.startTime,
    endTime: booking.endTime,
  });
};
