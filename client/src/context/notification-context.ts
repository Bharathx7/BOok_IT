import { createContext, useContext } from "react";
import type { AppNotification } from "../services/notification.api";

export interface NotificationContextType {
  /** Most recent notifications, newest first (for the bell). */
  recent: AppNotification[];
  unreadCount: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  /** Reloads from the server (e.g. after the notifications page changes things). */
  refresh: () => Promise<void>;
}

export const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function useNotifications() {
  const context = useContext(NotificationContext);

  if (!context) {
    throw new Error("useNotifications must be used inside NotificationProvider");
  }

  return context;
}

/** Where clicking a notification should take the user. */
export function notificationHref(notification: AppNotification, role: string) {
  if (notification.type === "WAITLIST_AVAILABLE" && notification.data?.venueId) {
    return `/customer/venues/${notification.data.venueId}`;
  }
  if (notification.type === "VENUE_REVIEWED" && notification.data?.venueId) {
    return `/provider/venues/${notification.data.venueId}/edit`;
  }
  if (role === "PROVIDER") return "/provider/bookings";
  if (role === "ADMIN") return "/admin/bookings";
  if (notification.data?.bookingId && notification.type !== "BOOKING_COMPLETED") {
    return `/customer/bookings/${notification.data.bookingId}`;
  }
  return notification.type === "BOOKING_COMPLETED" ? "/customer/reviews" : "/customer/bookings";
}
