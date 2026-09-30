import prisma from "../config/prisma.js";
import type {
  Notification,
  NotificationChannel,
  NotificationType,
  Prisma,
} from "../generated/prisma/client.js";
import type { EmailContent } from "../emails/layout.js";
import { emitNotification } from "../sockets/socket.js";
import { NotFoundError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { buildPaginationMeta, type PaginationParams } from "../utils/pagination.js";
import { queueEmail, type EmailAttachment } from "./email.service.js";

export const NOTIFICATION_TYPES: NotificationType[] = [
  "BOOKING_REQUESTED",
  "BOOKING_CONFIRMED",
  "BOOKING_CANCELLED",
  "BOOKING_COMPLETED",
  "BOOKING_EXPIRED",
  "BOOKING_REMINDER",
  "BOOKING_RESCHEDULED",
  "WAITLIST_AVAILABLE",
  "VENUE_REVIEWED",
  "PAYMENT_REFUNDED",
];

export const NOTIFICATION_CHANNELS: NotificationChannel[] = ["IN_APP", "EMAIL"];

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Prisma.InputJsonObject;
  /** Sent too, unless the user turned email off for this type. */
  email?: { to: string; subject: string; content: EmailContent; attachments?: EmailAttachment[] };
  /** Set false for email-only messages (e.g. a receipt for the user's own action). */
  inApp?: boolean;
}

export const toNotificationDto = (notification: Notification) => ({
  id: notification.id,
  type: notification.type,
  title: notification.title,
  body: notification.body,
  data: notification.data,
  read: notification.readAt !== null,
  createdAt: notification.createdAt,
});

async function enabledChannels(userId: string, type: NotificationType) {
  const optOuts = await prisma.notificationPreference.findMany({
    where: { userId, type, enabled: false },
    select: { channel: true },
  });

  const disabled = new Set(optOuts.map((pref) => pref.channel));
  return {
    inApp: !disabled.has("IN_APP"),
    email: !disabled.has("EMAIL"),
  };
}

/**
 * Delivers one notification on every channel the user hasn't turned off.
 * Never throws: a notification problem must not undo the action behind it.
 */
export async function notify(input: NotifyInput) {
  try {
    const channels = await enabledChannels(input.userId, input.type);

    if (channels.inApp && input.inApp !== false) {
      const notification = await prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          ...(input.data && { data: input.data }),
        },
      });

      try {
        emitNotification(input.userId, toNotificationDto(notification));
      } catch {
        // Socket.io isn't running (scripts, tests); the bell picks it up on next load.
      }
    }

    if (input.email && channels.email) {
      await queueEmail(input.email.to, input.email.subject, input.email.content, input.email.attachments);
    }
  } catch (error) {
    logger.error({ err: error, userId: input.userId, type: input.type }, "Notification failed");
  }
}

export async function listNotifications(
  userId: string,
  pagination: PaginationParams,
  unreadOnly = false
) {
  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(unreadOnly && { readAt: null }),
  };

  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return {
    notifications: items.map(toNotificationDto),
    unreadCount,
    pagination: buildPaginationMeta(pagination, total),
  };
}

export const countUnread = (userId: string) =>
  prisma.notification.count({ where: { userId, readAt: null } });

export async function markRead(userId: string, notificationId: string) {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });

  if (!notification) {
    throw new NotFoundError("Notification not found");
  }

  const updated = notification.readAt
    ? notification
    : await prisma.notification.update({
        where: { id: notification.id },
        data: { readAt: new Date() },
      });

  return toNotificationDto(updated);
}

export async function markAllRead(userId: string) {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });

  return count;
}

/** The full type x channel matrix, with defaults filled in. */
export async function getPreferences(userId: string) {
  const stored = await prisma.notificationPreference.findMany({ where: { userId } });
  const lookup = new Map(stored.map((pref) => [`${pref.type}:${pref.channel}`, pref.enabled]));

  return NOTIFICATION_TYPES.flatMap((type) =>
    NOTIFICATION_CHANNELS.map((channel) => ({
      type,
      channel,
      enabled: lookup.get(`${type}:${channel}`) ?? true,
    }))
  );
}

export async function updatePreferences(
  userId: string,
  preferences: { type: NotificationType; channel: NotificationChannel; enabled: boolean }[]
) {
  await prisma.$transaction(
    preferences.map(({ type, channel, enabled }) =>
      prisma.notificationPreference.upsert({
        where: { userId_type_channel: { userId, type, channel } },
        update: { enabled },
        create: { userId, type, channel, enabled },
      })
    )
  );

  return getPreferences(userId);
}
