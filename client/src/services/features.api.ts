import api from "./api";
import type { PaymentSummary } from "./payment.api";
import type { PaymentMode } from "./venue.api";

// Phase 5: booking detail, reschedule, weekly series, invites, check-in, waitlist.

export interface Participant {
  id: string;
  email: string;
  name: string | null;
  status: "INVITED" | "ACCEPTED" | "DECLINED";
  respondedAt: string | null;
  userId?: string | null;
}

export interface BookingDetail {
  id: string;
  userId: string;
  venueId: string;
  status: string;
  source: "ONLINE" | "WALK_IN" | "BLOCK";
  startTime: string;
  endTime: string;
  expiresAt: string | null;
  bookingCode: string | null;
  checkedInAt: string | null;
  noShow: boolean;
  totalPrice: string | null;
  priceBreakdown: { label: string; amount: number; start: string; end: string }[] | null;
  discountAmount: string | null;
  coupon: { code: string } | null;
  refundPercent: number | null;
  refundAmount: string | null;
  recurringGroupId: string | null;
  venue: {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    timezone: string;
    ownerId: string;
    latitude: number | null;
    longitude: number | null;
    paymentMode: PaymentMode;
  };
  payments: PaymentSummary[];
  user: { id: string; name: string; email: string | null };
  review: { id: string; rating: number; review: string | null; providerReply: string | null } | null;
  participants: Participant[];
  rescheduledFrom: { id: string; startTime: string; endTime: string } | null;
  rescheduledTo: { id: string; startTime: string; endTime: string } | null;
  recurringGroup: { id: string; weeks: number; weekday: number; startTime: string } | null;
  canManage: boolean;
  canReschedule: boolean;
  timeline: { at: string; label: string }[];
  series: { id: string; startTime: string; status: string }[];
}

export interface SeriesWeek {
  startTime: string;
  endTime: string;
  available: boolean;
  reason: string | null;
}

export interface Invite {
  status: Participant["status"];
  email: string;
  organiser: string;
  bookingStatus: string;
  startTime: string;
  endTime: string;
  venue: { id: string; name: string; address: string | null; city: string | null; timezone: string };
}

export interface ArrivalBooking {
  id: string;
  bookingCode: string | null;
  status: string;
  source: "ONLINE" | "WALK_IN" | "BLOCK";
  startTime: string;
  endTime: string;
  checkedInAt: string | null;
  noShow: boolean;
  guestName: string | null;
  user: { name: string };
  venue: { id: string; name: string; timezone: string };
  _count: { participants: number };
}

export interface WaitlistEntry {
  id: string;
  venueId: string;
  startTime: string;
  endTime: string;
  status: "WAITING" | "NOTIFIED";
  notifiedAt: string | null;
  venue: { id: string; name: string; timezone: string };
}

export const getBookingDetail = async (id: string) =>
  (await api.get<{ booking: BookingDetail }>(`/bookings/${id}/details`)).data.booking;

export const rescheduleBooking = async (id: string, startTime: string, endTime: string) =>
  (await api.put<{ booking: { id: string } }>(`/bookings/${id}/reschedule`, { startTime, endTime })).data.booking;

export const previewSeries = async (body: { venueId: string; startTime: string; durationMinutes: number; weeks: number }) =>
  (await api.post<{ weeks: SeriesWeek[] }>("/bookings/recurring/preview", body)).data.weeks;

export const createSeries = async (body: { venueId: string; startTime: string; durationMinutes: number; weeks: number }) =>
  (await api.post<{ groupId: string; booked: number; skipped: number }>("/bookings/recurring", body)).data;

export const cancelSeries = async (groupId: string) =>
  (await api.post<{ cancelled: number }>(`/bookings/recurring/${groupId}/cancel`)).data;

export const inviteParticipants = async (bookingId: string, invites: { email: string; name?: string }[]) =>
  (await api.post<{ participants: Participant[] }>(`/bookings/${bookingId}/participants`, { invites })).data.participants;

export const removeParticipant = async (bookingId: string, participantId: string) => {
  await api.delete(`/bookings/${bookingId}/participants/${participantId}`);
};

export const getInvite = async (token: string) => (await api.get<{ invite: Invite }>(`/invites/${token}`)).data.invite;

export const respondToInvite = async (token: string, accept: boolean) =>
  (await api.post<{ status: string; bookingId: string }>(`/invites/${token}/respond`, { accept })).data;

export const checkInByCode = async (code: string) =>
  (await api.post<{ booking: ArrivalBooking }>("/check-in", { code })).data.booking;

export const setNoShow = async (bookingId: string, noShow: boolean) =>
  (await api.patch<{ booking: ArrivalBooking }>(`/bookings/${bookingId}/no-show`, { noShow })).data.booking;

export const getArrivals = async (venueId: string) =>
  (await api.get<{ bookings: ArrivalBooking[] }>("/provider/arrivals", { params: { venueId } })).data.bookings;

export const getMyWaitlist = async () => (await api.get<{ entries: WaitlistEntry[] }>("/waitlist")).data.entries;

export const joinWaitlist = async (venueId: string, startTime: string, endTime: string) =>
  (await api.post<{ position: number }>("/waitlist", { venueId, startTime, endTime })).data;

export const leaveWaitlist = async (id: string) => {
  await api.delete(`/waitlist/${id}`);
};
