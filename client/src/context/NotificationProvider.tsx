import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { socket } from "../socket";
import { useAuth } from "./useAuth";
import { useToast } from "./toast-context";
import { NotificationContext, notificationHref } from "./notification-context";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "../services/notification.api";

const RECENT_LIMIT = 10;

interface State {
  userId: string | null;
  recent: AppNotification[];
  unreadCount: number;
}

const EMPTY: State = { userId: null, recent: [], unreadCount: 0 };

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [state, setState] = useState<State>(EMPTY);
  const userId = user?.id ?? null;

  // State belongs to one user; after sign-out or switching accounts, ignore it.
  const current = state.userId === userId ? state : EMPTY;

  const load = useCallback(async (forUserId: string) => {
    const page = await getNotifications({ limit: RECENT_LIMIT });
    setState({ userId: forUserId, recent: page.notifications, unreadCount: page.unreadCount });
  }, []);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    getNotifications({ limit: RECENT_LIMIT })
      .then((page) => {
        if (!cancelled) {
          setState({ userId, recent: page.notifications, unreadCount: page.unreadCount });
        }
      })
      .catch((error: unknown) => console.warn("Failed to load notifications", error));

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Live updates: the server only sends a user's own notifications to them.
  useEffect(() => {
    if (!userId || !user) return;

    const role = user.role;

    const onNotification = (notification: AppNotification) => {
      setState((previous) => {
        const base = previous.userId === userId ? previous : { ...EMPTY, userId };
        return {
          userId,
          recent: [notification, ...base.recent.filter((n) => n.id !== notification.id)].slice(
            0,
            RECENT_LIMIT
          ),
          unreadCount: base.unreadCount + (notification.read ? 0 : 1),
        };
      });

      showToast({
        title: notification.title,
        body: notification.body,
        href: notificationHref(notification, role),
      });
    };

    socket.on("notification", onNotification);
    return () => {
      socket.off("notification", onNotification);
    };
  }, [userId, user, showToast]);

  const markRead = useCallback(async (id: string) => {
    const updated = await markNotificationRead(id);

    setState((previous) => {
      const wasUnread = previous.recent.some((n) => n.id === id && !n.read);
      return {
        ...previous,
        recent: previous.recent.map((n) => (n.id === id ? updated : n)),
        unreadCount: Math.max(0, previous.unreadCount - (wasUnread ? 1 : 0)),
      };
    });
  }, []);

  const markAllRead = useCallback(async () => {
    await markAllNotificationsRead();
    setState((previous) => ({
      ...previous,
      recent: previous.recent.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  }, []);

  const refresh = useCallback(async () => {
    if (userId) await load(userId);
  }, [userId, load]);

  const value = useMemo(
    () => ({
      recent: current.recent,
      unreadCount: current.unreadCount,
      markRead,
      markAllRead,
      refresh,
    }),
    [current.recent, current.unreadCount, markRead, markAllRead, refresh]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
