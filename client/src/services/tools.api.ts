import api from "./api";
import type { PageParams, Pagination } from "../lib/pagination";

// Scheduling, pricing and reporting tools (Phase 4).

export interface DaySchedule {
  date: string;
  timezone: string;
  slotMinutes: number;
  maxBookingMinutes: number;
  pricePerHour: number;
  windows: { startTime: string; endTime: string }[];
  busy: { startTime: string; endTime: string; kind: "booked" | "closed"; reason?: string | null }[];
}

export interface PriceLine {
  label: string;
  ruleId: string | null;
  start: string;
  end: string;
  ratePerHour: number | null;
  amount: number;
}

export interface PriceQuote {
  total: number;
  basePricePerHour: number;
  breakdown: PriceLine[];
}

export interface SlotTemplate {
  id: string;
  name: string | null;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
}

export type SlotTemplateInput = Omit<SlotTemplate, "id">;

export interface GenerationResult {
  created: number;
  planned: { date: string; startTime: string; endTime: string }[];
  skipped: { date: string; startTime: string; endTime: string; reason: string }[];
}

export interface Blackout {
  id: string;
  startTime: string;
  endTime: string;
  reason: string | null;
}

export interface PricingRule {
  id: string;
  name: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  validFrom: string | null;
  validTo: string | null;
  type: "FIXED" | "MULTIPLIER";
  value: string | number;
  priority: number;
  isActive: boolean;
}

export type PricingRuleInput = Omit<PricingRule, "id" | "value"> & { value: number };

export interface RefundQuote {
  refundPercent: number;
  refundAmount: number;
  hoursBeforeStart: number;
  reason: string;
}

export interface ProviderReview {
  id: string;
  rating: number;
  review: string | null;
  createdAt: string;
  providerReply: string | null;
  providerRepliedAt: string | null;
  user: { name: string };
  venue: { id: string; name: string };
}

export interface Analytics {
  range: { from: string; to: string; timeZone: string };
  summary: {
    revenue: number;
    bookings: number;
    walkIns: number;
    averageBookingValue: number;
    bookedHours: number;
    openHours: number;
    occupancyPercent: number;
    cancellationRatePercent: number;
    byStatus: Record<string, number>;
  };
  daily: { date: string; revenue: number; bookings: number }[];
  heatmap: { weekday: number; hour: number; bookedHours: number; openHours: number }[];
  topCustomers: { name: string; email: string; bookings: number; spent: number }[];
  ratingTrend: { month: string; averageRating: number; reviews: number }[];
  perVenue: { venueId: string; name: string; revenue: number; bookings: number; occupancyPercent: number }[];
}

const venuePath = (venueId: string, path: string) => `/venues/${venueId}/${path}`;

// Booking page

export const getDaySchedule = async (venueId: string, date: string) =>
  (await api.get<{ schedule: DaySchedule }>(venuePath(venueId, "schedule"), { params: { date } })).data.schedule;

export const getPriceQuote = async (venueId: string, startTime: string, endTime: string) =>
  (await api.get<{ quote: PriceQuote }>(venuePath(venueId, "quote"), { params: { startTime, endTime } })).data
    .quote;

export const getCancellationQuote = async (bookingId: string) =>
  (await api.get<{ quote: RefundQuote }>(`/bookings/${bookingId}/cancellation-quote`)).data.quote;

// Templates

export const listTemplates = async (venueId: string) =>
  (await api.get<{ templates: SlotTemplate[] }>(venuePath(venueId, "templates"))).data.templates;

export const createTemplate = async (venueId: string, input: SlotTemplateInput) =>
  (await api.post<{ template: SlotTemplate }>(venuePath(venueId, "templates"), input)).data.template;

export const updateTemplate = async (venueId: string, id: string, input: Partial<SlotTemplateInput>) =>
  (await api.put<{ template: SlotTemplate }>(venuePath(venueId, `templates/${id}`), input)).data.template;

export const deleteTemplate = async (venueId: string, id: string, removeFutureSlots: boolean) =>
  (
    await api.delete<{ removedSlots: number }>(venuePath(venueId, `templates/${id}`), {
      params: { removeFutureSlots },
    })
  ).data;

export const generateSlots = async (
  venueId: string,
  body: { days: number; fromDate?: string; dryRun?: boolean; templateIds?: string[] }
) => (await api.post<GenerationResult>(venuePath(venueId, "templates/generate"), body)).data;

// Blackouts

export const listBlackouts = async (venueId: string) =>
  (await api.get<{ blackouts: Blackout[] }>(venuePath(venueId, "blackouts"))).data.blackouts;

export const createBlackout = async (
  venueId: string,
  body: { startTime: string; endTime: string; reason?: string | null }
) => (await api.post<{ blackout: Blackout; affectedBookings: number }>(venuePath(venueId, "blackouts"), body)).data;

export const deleteBlackout = async (venueId: string, id: string) => {
  await api.delete(venuePath(venueId, `blackouts/${id}`));
};

// Pricing rules

export const listPricingRules = async (venueId: string) =>
  (await api.get<{ rules: PricingRule[] }>(venuePath(venueId, "pricing-rules"))).data.rules;

export const createPricingRule = async (venueId: string, input: PricingRuleInput) =>
  (await api.post<{ rule: PricingRule }>(venuePath(venueId, "pricing-rules"), input)).data.rule;

export const updatePricingRule = async (venueId: string, id: string, input: Partial<PricingRuleInput>) =>
  (await api.put<{ rule: PricingRule }>(venuePath(venueId, `pricing-rules/${id}`), input)).data.rule;

export const deletePricingRule = async (venueId: string, id: string) => {
  await api.delete(venuePath(venueId, `pricing-rules/${id}`));
};

// Walk-ins and blocked time

export const createManualBooking = async (body: {
  venueId: string;
  startTime: string;
  endTime: string;
  kind: "WALK_IN" | "BLOCK";
  guestName?: string;
  guestPhone?: string;
  note?: string;
  price?: number;
}) => (await api.post<{ booking: unknown }>("/bookings/manual", body)).data.booking;

// Reviews

export const listProviderReviews = async (params: PageParams & { unanswered?: boolean; venueId?: string }) =>
  (await api.get<{ reviews: ProviderReview[]; pagination: Pagination }>("/provider/reviews", { params })).data;

export const replyToReview = async (reviewId: string, reply: string) => {
  await api.put(`/reviews/${reviewId}/reply`, { reply });
};

export const deleteReviewReply = async (reviewId: string) => {
  await api.delete(`/reviews/${reviewId}/reply`);
};

// Reports

export const getAnalytics = async (params: { from: string; to: string; venueId?: string }) =>
  (await api.get<Analytics>("/provider/analytics", { params })).data;

/** Downloads the CSV through the authenticated client, then saves it. */
export async function downloadBookingsCsv(params: { from: string; to: string; venueId?: string }) {
  const response = await api.get<Blob>("/provider/bookings/export", { params, responseType: "blob" });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bookit-bookings-${params.from}-to-${params.to}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Provider calendar

export interface CalendarBooking {
  id: string;
  status: "PENDING" | "CONFIRMED" | "COMPLETED";
  source: "ONLINE" | "WALK_IN" | "BLOCK";
  startTime: string;
  endTime: string;
  expiresAt: string | null;
  totalPrice: string | null;
  note: string | null;
  customer: { name: string; email: string | null; phone: string | null } | null;
}

export interface CalendarData {
  venue: { id: string; name: string; timezone: string };
  slots: { id: string; startTime: string; endTime: string }[];
  blackouts: { id: string; startTime: string; endTime: string; reason: string | null }[];
  bookings: CalendarBooking[];
}

export const getProviderCalendar = async (params: { venueId: string; from: string; to: string }) =>
  (await api.get<CalendarData>("/provider/calendar", { params })).data;
