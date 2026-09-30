import api from "./api";
import type { Pagination } from "../lib/pagination";

export type NotificationType =
  | "BOOKING_REQUESTED"
  | "BOOKING_CONFIRMED"
  | "BOOKING_CANCELLED"
  | "BOOKING_COMPLETED"
  | "BOOKING_EXPIRED"
  | "BOOKING_REMINDER"
  | "BOOKING_RESCHEDULED"
  | "PAYMENT_REFUNDED"
  | "WAITLIST_AVAILABLE"
  | "VENUE_REVIEWED";

export type NotificationChannel = "IN_APP" | "EMAIL";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: { bookingId?: string; venueId?: string; recurringGroupId?: string } | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationPreference {
  type: NotificationType;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface NotificationPage {
  notifications: AppNotification[];
  unreadCount: number;
  pagination: Pagination;
}

export async function getNotifications(
  params: { page?: number; limit?: number; unread?: boolean } = {}
): Promise<NotificationPage> {
  const response = await api.get<NotificationPage>("/notifications", { params });
  return response.data;
}

export async function getUnreadCount(): Promise<number> {
  const response = await api.get<{ unreadCount: number }>("/notifications/unread-count");
  return response.data.unreadCount;
}

export async function markNotificationRead(id: string): Promise<AppNotification> {
  const response = await api.patch<{ notification: AppNotification }>(`/notifications/${id}/read`);
  return response.data.notification;
}

export async function markAllNotificationsRead(): Promise<number> {
  const response = await api.post<{ updated: number }>("/notifications/read-all");
  return response.data.updated;
}

export async function getNotificationPreferences(): Promise<NotificationPreference[]> {
  const response = await api.get<{ preferences: NotificationPreference[] }>(
    "/notifications/preferences"
  );
  return response.data.preferences;
}

export async function updateNotificationPreferences(
  preferences: NotificationPreference[]
): Promise<NotificationPreference[]> {
  const response = await api.put<{ preferences: NotificationPreference[] }>(
    "/notifications/preferences",
    { preferences }
  );
  return response.data.preferences;
}
