import { randomUUID } from "crypto";
import { createServer, type Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import { jest } from "@jest/globals";
import { Server } from "socket.io";
import { io as connectClient, type Socket as ClientSocket } from "socket.io-client";

import { emitBookingEvent, initializeSocket, rooms } from "../src/sockets/socket.js";
import { generateAccessToken } from "../src/utils/jwt.js";

jest.setTimeout(15000);

type Received = { event: string; payload: Record<string, unknown> };

// How long to wait before concluding that an event was *not* delivered.
const SILENCE_MS = 300;

const waitFor = async (condition: () => boolean | Promise<boolean>, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const tokenFor = (role: "USER" | "PROVIDER" | "ADMIN") => {
  const id = randomUUID();
  return {
    id,
    token: generateAccessToken({ id, email: `${id}@example.com`, role }),
  };
};

describe("Socket.io rooms", () => {
  let httpServer: HttpServer;
  let io: Server;
  let url: string;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    httpServer = createServer();
    io = new Server(httpServer);
    initializeSocket(io);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });

  /** Connects a client and records every event it receives. */
  const connect = async (token?: string) => {
    const client = connectClient(url, {
      auth: token ? { token } : {},
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    clients.push(client);

    const received: Received[] = [];
    client.onAny((event: string, payload: Record<string, unknown>) => {
      received.push({ event, payload });
    });

    await new Promise<void>((resolve, reject) => {
      client.once("connect", () => resolve());
      client.once("connect_error", reject);
    });

    return { client, received };
  };

  const roomSize = async (room: string) => (await io.in(room).fetchSockets()).length;

  it("rejects a connection with an invalid token", async () => {
    await expect(connect("not-a-real-token")).rejects.toThrow(
      "Invalid or expired token"
    );
  });

  it("puts authenticated users in their own room and admins in the admin room", async () => {
    const customer = tokenFor("USER");
    const admin = tokenFor("ADMIN");

    await connect(customer.token);
    await connect(admin.token);

    await waitFor(async () => (await roomSize(rooms.user(customer.id))) === 1);
    await waitFor(async () => (await roomSize(rooms.user(admin.id))) === 1);
    expect(await roomSize(rooms.admin)).toBe(1);
  });

  it("delivers booking events only to the customer, venue owner and admins", async () => {
    const customer = tokenFor("USER");
    const otherCustomer = tokenFor("USER");
    const owner = tokenFor("PROVIDER");
    const admin = tokenFor("ADMIN");
    const venueId = randomUUID();

    const customerSocket = await connect(customer.token);
    const otherSocket = await connect(otherCustomer.token);
    const ownerSocket = await connect(owner.token);
    const adminSocket = await connect(admin.token);
    const anonymousSocket = await connect();
    const venueViewer = await connect();

    venueViewer.client.emit("venue:join", venueId);
    await waitFor(async () => (await roomSize(rooms.venue(venueId))) === 1);
    await waitFor(async () => (await roomSize(rooms.admin)) === 1);

    const booking = {
      id: randomUUID(),
      userId: customer.id,
      venueId,
      status: "PENDING",
      startTime: new Date("2030-01-01T10:00:00.000Z"),
      endTime: new Date("2030-01-01T11:00:00.000Z"),
    };

    emitBookingEvent("bookingCreated", booking, owner.id);

    const expectedPayload = {
      bookingId: booking.id,
      userId: customer.id,
      venueId,
      status: "PENDING",
    };

    for (const recipient of [customerSocket, ownerSocket, adminSocket]) {
      await waitFor(() => recipient.received.length > 0);
      expect(recipient.received).toEqual([
        { event: "bookingCreated", payload: expectedPayload },
      ]);
    }

    await waitFor(() => venueViewer.received.length > 0);
    await new Promise((resolve) => setTimeout(resolve, SILENCE_MS));

    // The venue page only learns that availability changed - no personal data.
    expect(venueViewer.received).toEqual([
      {
        event: "venueAvailabilityChanged",
        payload: {
          venueId,
          startTime: booking.startTime.toISOString(),
          endTime: booking.endTime.toISOString(),
        },
      },
    ]);

    expect(otherSocket.received).toEqual([]);
    expect(anonymousSocket.received).toEqual([]);
  });

  it("ignores venue:join with an invalid venue id", async () => {
    const viewer = await connect();

    viewer.client.emit("venue:join", "../../admin");
    await new Promise((resolve) => setTimeout(resolve, SILENCE_MS));

    const [serverSocket] = await io.in(viewer.client.id!).fetchSockets();
    expect([...serverSocket.rooms].filter((room) => room !== serverSocket.id)).toEqual([]);
  });
});
