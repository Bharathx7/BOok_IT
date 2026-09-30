import api from "./api";
import type { PageParams, Paginated, Pagination } from "../lib/pagination";

export type UserRole = "USER" | "PROVIDER" | "ADMIN";
export type UserStatus = "ACTIVE" | "SUSPENDED" | "BANNED";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
export type ReviewStatus = "VISIBLE" | "FLAGGED" | "HIDDEN";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface AdminBookingUser {
  id: string;
  name: string;
  email: string;
}

export interface AdminBooking {
  id: string;
  bookingCode: string | null;
  status: string;
  source: "ONLINE" | "WALK_IN" | "BLOCK";
  startTime: string;
  endTime: string;
  createdAt: string;
  totalPrice: string | null;
  discountAmount: string | null;
  guestName: string | null;
  coupon: { code: string } | null;
  user: AdminBookingUser;
  venue: {
    id: string;
    name: string;
    timezone: string;
    owner: AdminBookingUser;
  };
}

const clean = <T extends object>(params: T) =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== ""));

export const getAdminBookings = async (
  params: PageParams & { q?: string; status?: string; venueId?: string } = {}
): Promise<Paginated<AdminBooking>> => {
  const response = await api.get<{ bookings: AdminBooking[]; pagination: Pagination }>(
    "/admin/bookings",
    { params: clean(params) }
  );

  return { items: response.data.bookings, pagination: response.data.pagination };
};

export const getAdminUsers = async (
  params: PageParams & { role?: string; status?: string; q?: string } = {}
): Promise<Paginated<AdminUser>> => {
  const response = await api.get<{ users: AdminUser[]; pagination: Pagination }>(
    "/admin/users",
    { params: clean(params) }
  );

  return { items: response.data.users, pagination: response.data.pagination };
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface AdminDashboardStats {
  users: number;
  providers: number;
  venues: number;
  bookings: number;
  bookingStats: { pending: number; confirmed: number; completed: number; cancelled: number; expired: number };
  queues: { venuesAwaitingApproval: number; flaggedReviews: number; suspendedUsers: number };
}

export const getAdminDashboard = async () =>
  (await api.get<{ dashboard: AdminDashboardStats }>("/admin/dashboard")).data.dashboard;

// ---------------------------------------------------------------------------
// User detail
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: { id: string; name: string; role?: string } | null;
}

export interface AdminUserDetail {
  user: AdminUser & {
    phone: string | null;
    avatarUrl: string | null;
    statusReason: string | null;
    statusChangedAt: string | null;
    _count: { bookings: number; reviews: number; ownedVenues: number; reviewReports: number };
  };
  recentBookings: {
    id: string;
    bookingCode: string | null;
    status: string;
    source: string;
    startTime: string;
    endTime: string;
    totalPrice: string | null;
    venue: { id: string; name: string; timezone: string };
  }[];
  upcomingBookings: number;
  venues: { id: string; name: string; city: string | null; isActive: boolean; approvalStatus: ApprovalStatus; _count: { bookings: number } }[];
  activeSessions: number;
  history: AuditEntry[];
  actionsTaken: { id: string; action: string; entityType: string; entityId: string | null; createdAt: string }[];
}

export const getAdminUserDetail = async (userId: string) =>
  (await api.get<AdminUserDetail>(`/admin/users/${userId}`)).data;

export const setUserStatus = async (userId: string, status: UserStatus, reason?: string) =>
  (await api.patch<{ user: { status: UserStatus } }>(`/admin/users/${userId}/status`, { status, reason: reason || null })).data.user;

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------

export interface AdminVenue {
  id: string;
  name: string;
  description: string | null;
  category: string;
  address: string | null;
  city: string | null;
  pricePerHour: string;
  isActive: boolean;
  approvalStatus: ApprovalStatus;
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string; email: string; status: UserStatus };
  images: { url: string }[];
  _count: { bookings: number; reviews: number; availability: number };
}

export const getAdminVenues = async (
  params: PageParams & { approvalStatus?: ApprovalStatus; q?: string } = {}
): Promise<Paginated<AdminVenue>> => {
  const response = await api.get<{ venues: AdminVenue[]; pagination: Pagination }>("/admin/venues", {
    params: clean(params),
  });
  return { items: response.data.venues, pagination: response.data.pagination };
};

export const reviewVenue = async (venueId: string, decision: "APPROVED" | "REJECTED", reason?: string) =>
  (await api.post(`/admin/venues/${venueId}/review`, { decision, reason: reason || null })).data;

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export interface ModerationReview {
  id: string;
  rating: number;
  review: string | null;
  status: ReviewStatus;
  moderationNote: string | null;
  moderatedAt: string | null;
  createdAt: string;
  providerReply: string | null;
  user: { id: string; name: string; email: string };
  venue: { id: string; name: string };
  reports: {
    id: string;
    reason: string;
    createdAt: string;
    resolvedAt: string | null;
    reporter: { id: string; name: string; email: string };
  }[];
}

export const getModerationReviews = async (
  params: PageParams & { status?: ReviewStatus } = {}
): Promise<Paginated<ModerationReview>> => {
  const response = await api.get<{ reviews: ModerationReview[]; pagination: Pagination }>("/admin/reviews", {
    params: clean(params),
  });
  return { items: response.data.reviews, pagination: response.data.pagination };
};

export const moderateReview = async (reviewId: string, status: "HIDDEN" | "VISIBLE", note?: string) =>
  (await api.post<{ review: ModerationReview }>(`/admin/reviews/${reviewId}/moderate`, { status, note: note || null })).data.review;

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  type: "PERCENT" | "FLAT";
  value: string;
  maxDiscount: string | null;
  maxUses: number | null;
  perUserLimit: number | null;
  minAmount: string | null;
  validFrom: string | null;
  validTo: string | null;
  venueId: string | null;
  isActive: boolean;
  createdAt: string;
  venue: { id: string; name: string } | null;
  uses: number;
  totalDiscount: number;
}

export interface CouponInput {
  code: string;
  description: string | null;
  type: "PERCENT" | "FLAT";
  value: number;
  maxDiscount: number | null;
  maxUses: number | null;
  perUserLimit: number | null;
  minAmount: number | null;
  validFrom: string | null;
  validTo: string | null;
  venueId: string | null;
  isActive: boolean;
}

export const getCoupons = async (params: PageParams & { q?: string; active?: string } = {}): Promise<Paginated<Coupon>> => {
  const response = await api.get<{ coupons: Coupon[]; pagination: Pagination }>("/admin/coupons", { params: clean(params) });
  return { items: response.data.coupons, pagination: response.data.pagination };
};

export const createCoupon = async (input: CouponInput) =>
  (await api.post<{ coupon: Coupon }>("/admin/coupons", input)).data.coupon;

export const updateCoupon = async (id: string, input: Partial<CouponInput>) =>
  (await api.patch<{ coupon: Coupon }>(`/admin/coupons/${id}`, input)).data.coupon;

export const deleteCoupon = async (id: string) => {
  await api.delete(`/admin/coupons/${id}`);
};

// ---------------------------------------------------------------------------
// Audit log, search, settings, analytics
// ---------------------------------------------------------------------------

export interface AuditFilters {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

export const getAuditLogs = async (params: PageParams & AuditFilters = {}) => {
  const response = await api.get<{ logs: AuditEntry[]; actions: string[]; pagination: Pagination }>("/admin/audit-logs", {
    params: clean(params),
  });
  return response.data;
};

export interface AdminSearchResults {
  users: { id: string; name: string; email: string; role: UserRole; status: UserStatus }[];
  venues: { id: string; name: string; city: string | null; approvalStatus: ApprovalStatus; isActive: boolean }[];
  bookings: {
    id: string;
    bookingCode: string | null;
    status: string;
    startTime: string;
    user: { name: string; email: string };
    venue: { name: string; timezone: string };
  }[];
}

export const adminSearch = async (q: string) =>
  (await api.get<AdminSearchResults>("/admin/search", { params: { q } })).data;

export interface PlatformSetting {
  key: string;
  label: string;
  description: string;
  default: boolean | number;
  value: boolean | number;
}

export const getSettings = async () => (await api.get<{ settings: PlatformSetting[] }>("/admin/settings")).data.settings;

export const updateSettings = async (changes: Record<string, boolean | number>) =>
  (await api.put<{ settings: PlatformSetting[] }>("/admin/settings", changes)).data.settings;

export interface PlatformAnalytics {
  range: { from: string; to: string; days: number; timezone: string };
  summary: {
    gmv: number;
    bookings: number;
    averageBookingValue: number;
    commissionPercent: number;
    estimatedCommission: number;
    discounts: number;
    couponBookings: number;
    walkIns: number;
    newUsers: number;
    newProviders: number;
    newVenues: number;
  };
  conversion: {
    requests: number;
    converted: number;
    conversionPercent: number;
    cancelledPercent: number;
    expiredPercent: number;
    pending: number;
    byStatus: Record<string, number>;
  };
  daily: { date: string; bookings: number; gmv: number }[];
  topVenues: { id: string; name: string; city: string | null; bookings: number; gmv: number }[];
  topCities: { city: string; venues: number; bookings: number; gmv: number }[];
  cohorts: { cohort: string; users: number; retention: number[] }[];
}

export const getPlatformAnalytics = async (from: string, to: string) =>
  (await api.get<PlatformAnalytics>("/admin/analytics", { params: { from, to } })).data;
