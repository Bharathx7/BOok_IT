import api from "./api";
import type { CheckoutOrder } from "./payment.api";
import type { PageParams, Paginated, Pagination } from "../lib/pagination";

export interface BookingVenue {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  pricePerHour: string;
  timezone: string;
}

export interface BookingReview {
  id: string;
  rating: number;
  review: string | null;
}

export interface Booking {
  id: string;
  userId: string;
  venueId: string;
  startTime: string;
  endTime: string;
  status: string;
  /** PENDING: when the request expires if not confirmed. AWAITING_PAYMENT: when the time to pay runs out. */
  expiresAt: string | null;
  source: "ONLINE" | "WALK_IN" | "BLOCK";
  guestName: string | null;
  guestPhone: string | null;
  note: string | null;
  /** Price fixed at booking time (rupees, as a decimal string). */
  totalPrice: string | null;
  priceBreakdown: { label: string; amount: number; ratePerHour: number | null }[] | null;
  /** Rupees taken off by a coupon; totalPrice is already after it. */
  discountAmount?: string | null;
  cancelledAt: string | null;
  refundPercent: number | null;
  refundAmount: string | null;
  createdAt: string;
  updatedAt: string;
  venue: BookingVenue;
  review?: BookingReview | null;
  user?: {
    id: string;
    name: string;
    email: string;
  };
}

interface GetBookingsResponse {
  bookings: Booking[];
  pagination: Pagination;
}

interface CancelBookingResponse {
  message: string;
  booking: Booking;
}

/**
 * "upcoming": still to be played, soonest first. "past": the rest, latest
 * first. "pending" (venue side): requests waiting for confirmation.
 */
export type BookingScope = "upcoming" | "past" | "pending";

export const getBookings = async (
  params: PageParams & { scope?: BookingScope } = {}
): Promise<Paginated<Booking>> => {
  const response = await api.get<GetBookingsResponse>("/bookings", { params });

  return { items: response.data.bookings, pagination: response.data.pagination };
};

export const cancelBooking = async (
  bookingId: string
): Promise<Booking> => {
  const response = await api.patch<CancelBookingResponse>(
    `/bookings/${bookingId}/cancel`
  );

  return response.data.booking;
};

interface CreateBookingRequest {
  venueId: string;
  startTime: string;
  endTime: string;
  couponCode?: string;
}

export interface CouponQuote {
  subtotal: number;
  discount: number;
  total: number;
  coupon: { code: string; description: string | null; type: "PERCENT" | "FLAT"; value: number };
}

/** Checks a code for the time the customer picked; throws with the reason if it doesn't apply. */
export const previewCoupon = async (data: { code: string; venueId: string; startTime: string; endTime: string }) =>
  (await api.post<{ quote: CouponQuote }>("/coupons/preview", data)).data.quote;

interface CreateBookingResponse {
  message: string;
  booking: Booking;
  /** At a pay-online venue: the order to pay (the booking waits for it). */
  payment: CheckoutOrder | null;
}

export const createBooking = async (data: CreateBookingRequest) => {
  const response = await api.post<CreateBookingResponse>("/bookings", data);
  return { booking: response.data.booking, payment: response.data.payment };
};

export const getProviderBookings = async (
  params: PageParams & { scope?: BookingScope } = {}
): Promise<Paginated<Booking>> => {
  const response = await api.get<GetBookingsResponse>(
    "/bookings/provider",
    { params }
  );

  return { items: response.data.bookings, pagination: response.data.pagination };
};

export const confirmBooking = async (
  bookingId: string
): Promise<Booking> => {
  const response = await api.patch<{
    message: string;
    booking: Booking;
  }>(`/bookings/${bookingId}/confirm`);

  return response.data.booking;
};

export const completeBooking = async (
  bookingId: string
): Promise<Booking> => {
  const response = await api.patch<{
    message: string;
    booking: Booking;
  }>(`/bookings/${bookingId}/complete`);

  return response.data.booking;
};