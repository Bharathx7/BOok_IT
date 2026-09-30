import {
  jest,
  describe,
  beforeEach,
  test,
  expect,
} from "@jest/globals";

type UserMock = {
  id: string;
  name: string;
  email: string;
};

type VenueMock = {
  id: string;
  name: string;
  ownerId: string;
  pendingHoldMinutes: number;
  slotMinutes?: number;
  maxBookingMinutes?: number;
  pricePerHour?: number;
  timezone?: string;
  pricingRules?: unknown[];
};

type TimeSlotMock = {
  id: string;
  venueId: string;
  startTime: Date;
  endTime: Date;
};

type BookingMock = {
  id: string;
  venueId: string;
  startTime: Date;
  endTime: Date;
  status: string;
};

type CreatedBookingMock = {
  id: string;
  userId: string;
  venueId: string;
  startTime: Date;
  endTime: Date;
  status: string;
  venue: {
    id: string;
    name: string;
  };
  user: {
    id: string;
    name: string;
    email: string;
  };
};

type CreateBookingArgs = {
  data: {
    userId: string;
    venueId: string;
    startTime: Date;
    endTime: Date;
    status: string;
    expiresAt: Date;
  };
  include: unknown;
};

const mockPrisma = {
  user: {
    findUnique: jest.fn<() => Promise<UserMock | null>>(),
  },

  venue: {
    findUnique: jest.fn<() => Promise<VenueMock | null>>(),
  },

  timeSlot: {
    findFirst: jest.fn<() => Promise<TimeSlotMock | null>>(),
  },

  booking: {
    findFirst: jest.fn<() => Promise<BookingMock | null>>(),
    // Overdue PENDING bookings to release; none by default.
    findMany: jest.fn(() => Promise.resolve([])),
    updateMany: jest.fn(() => Promise.resolve({ count: 0 })),

    create: jest.fn<
      (args: CreateBookingArgs) => Promise<CreatedBookingMock>
    >(),
  },

  blackoutDate: {
    findFirst: jest.fn(() => Promise.resolve(null)),
  },

  waitlistEntry: {
    updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
  },

  // Per-venue advisory lock.
  $executeRaw: jest.fn(() => Promise.resolve(1)),

  // createBooking runs its checks inside an interactive transaction; the mock
  // just hands the same client to the callback.
  $transaction: jest.fn(
    async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => callback(mockPrisma)
  ),
};

jest.unstable_mockModule("../src/config/prisma.js", () => ({
  default: mockPrisma,
}));

jest.unstable_mockModule("../src/sockets/socket.js", () => ({
  emitNotification: jest.fn(),
  emitBookingEvent: jest.fn(),
}));

jest.unstable_mockModule("../src/services/email.service.js", () => ({
  queueEmail: jest.fn(() => Promise.resolve()),
}));

const notifyBookingRequested = jest.fn(() => Promise.resolve());

jest.unstable_mockModule("../src/services/bookingNotifications.service.js", () => ({
  notifyBookingRequested,
  notifyBookingConfirmed: jest.fn(() => Promise.resolve()),
  notifyBookingCancelled: jest.fn(() => Promise.resolve()),
  notifyBookingCompleted: jest.fn(() => Promise.resolve()),
  notifyBookingExpired: jest.fn(() => Promise.resolve()),
  notifyBookingReminder: jest.fn(() => Promise.resolve()),
  notifyPaymentLapsed: jest.fn(() => Promise.resolve()),
  notifyPaymentConfirmed: jest.fn(() => Promise.resolve()),
  notifyOwnerPaidBooking: jest.fn(() => Promise.resolve()),
  notifyRefundProcessed: jest.fn(() => Promise.resolve()),
}));

const { createBooking } = await import(
  "../src/services/booking.service.js"
);

// Venue settings createBooking checks: 60-minute steps, 1000/hour, no rules.
const BOOKING_RULES = {
  slotMinutes: 60,
  maxBookingMinutes: 240,
  pricePerHour: 1000,
  timezone: "Asia/Kolkata",
  pricingRules: [],
};

describe("createBooking - booking conflict", () => {
  const userId = "user-1";
  const venueId = "venue-1";

  // Bookings in the past are rejected, so build times relative to now.
  const HOUR = 60 * 60 * 1000;
  const dayStart = new Date(Date.now() + 7 * 24 * HOUR);
  dayStart.setUTCHours(0, 0, 0, 0);
  const at = (hours: number) => new Date(dayStart.getTime() + hours * HOUR);

  const startTime = at(10);
  const endTime = at(12);

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma.user.findUnique.mockResolvedValue({
      id: userId,
      name: "Test User",
      email: "test@example.com",
    });

    mockPrisma.venue.findUnique.mockResolvedValue({
      id: venueId,
      name: "Test Venue",
      ownerId: "owner-1",
      isActive: true,
      approvalStatus: "APPROVED",
      owner: { status: "ACTIVE" },
      pendingHoldMinutes: 24 * 60,
      ...BOOKING_RULES,
    });

    mockPrisma.timeSlot.findFirst.mockResolvedValue({
      id: "slot-1",
      venueId,
      startTime: at(9),
      endTime: at(18),
    });
  });

  test("should reject an overlapping booking", async () => {
    mockPrisma.booking.findFirst.mockResolvedValue({
      id: "existing-booking",
      venueId,
      startTime: at(11),
      endTime: at(13),
      status: "CONFIRMED",
    });

    await expect(
      createBooking({
        userId,
        venueId,
        startTime,
        endTime,
      })
    ).rejects.toThrow("This time is already booked");

    expect(mockPrisma.booking.findFirst).toHaveBeenCalled();

    expect(mockPrisma.booking.create).not.toHaveBeenCalled();
  });

  test("should allow a non-overlapping booking", async () => {
    mockPrisma.booking.findFirst.mockResolvedValue(null);

    const createdBooking: CreatedBookingMock = {
      id: "booking-1",
      userId,
      venueId,
      startTime,
      endTime,
      status: "PENDING",

      venue: {
        id: venueId,
        name: "Test Venue",
      },

      user: {
        id: userId,
        name: "Test User",
        email: "test@example.com",
      },
    };

    mockPrisma.booking.create.mockResolvedValue(createdBooking);

    const result = await createBooking({
      userId,
      venueId,
      startTime,
      endTime,
    });

    expect(result).toEqual(createdBooking);

    expect(mockPrisma.booking.findFirst).toHaveBeenCalled();
    expect(mockPrisma.$executeRaw).toHaveBeenCalled();

    expect(mockPrisma.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId,
          venueId,
          startTime,
          endTime,
          status: "PENDING",
          expiresAt: expect.any(Date),
          // 2 hours at 1000/hour.
          totalPrice: 2000,
        }),
      })
    );

    // The owner gets the venue's hold time (24 h here) to confirm.
    const { expiresAt } = mockPrisma.booking.create.mock.calls[0]![0].data;
    expect(Math.abs(expiresAt.getTime() - (Date.now() + 24 * HOUR))).toBeLessThan(60_000);

    await new Promise((resolve) => setImmediate(resolve));
    expect(notifyBookingRequested).toHaveBeenCalledWith(createdBooking);
  });

  test("caps the confirmation deadline at the booking's start", async () => {
    mockPrisma.booking.findFirst.mockResolvedValue(null);
    mockPrisma.venue.findUnique.mockResolvedValue({
      id: venueId,
      name: "Test Venue",
      ownerId: "owner-1",
      isActive: true,
      approvalStatus: "APPROVED",
      owner: { status: "ACTIVE" },
      pendingHoldMinutes: 30 * 24 * 60,
      ...BOOKING_RULES,
    });
    mockPrisma.booking.create.mockResolvedValue({
      venue: { id: venueId, name: "Test Venue", ownerId: "owner-1" },
    } as unknown as CreatedBookingMock);

    await createBooking({ userId, venueId, startTime, endTime });

    expect(mockPrisma.booking.create.mock.calls[0]![0].data.expiresAt).toEqual(startTime);
  });
});