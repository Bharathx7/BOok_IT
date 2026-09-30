import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/ui/PageHeader";
import Pager from "../../components/ui/Pager";
import { useAuth } from "../../context/useAuth";
import { notificationHref, useNotifications } from "../../context/notification-context";
import {
  getNotificationPreferences,
  getNotifications,
  updateNotificationPreferences,
  type AppNotification,
  type NotificationChannel,
  type NotificationPreference,
  type NotificationType,
} from "../../services/notification.api";
import type { Pagination } from "../../lib/pagination";
import { timeAgo } from "../../lib/datetime";
import { alertError, alertSuccess, btnPrimary, btnSecondary, card } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";
import { translate } from "../../i18n/translate";
import EmptyState from "../../components/ui/EmptyState";
import { BellOff } from "lucide-react";

// Every type has "notifType.<TYPE>" and "notifHint.<TYPE>" messages.
const TYPES: NotificationType[] = [
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

const CHANNELS: NotificationChannel[] = ["IN_APP", "EMAIL"];

function NotificationList() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { markRead, markAllRead, unreadCount, refresh } = useNotifications();
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    getNotifications({ page, unread: unreadOnly })
      .then((result) => {
        if (cancelled) return;
        setItems(result.notifications);
        setPagination(result.pagination);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, translate("notif.loadFailed")));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, unreadOnly, reloadKey]);

  const reload = (changes: { page?: number; unreadOnly?: boolean } = {}) => {
    setLoading(true);
    setError("");
    if (changes.page !== undefined) setPage(changes.page);
    if (changes.unreadOnly !== undefined) setUnreadOnly(changes.unreadOnly);
    setReloadKey((key) => key + 1);
  };

  async function open(notification: AppNotification) {
    if (!notification.read) {
      await markRead(notification.id).catch(() => undefined);
    }
    navigate(notificationHref(notification, user!.role));
  }

  async function handleMarkAll() {
    try {
      await markAllRead();
      await refresh();
      reload();
    } catch (err) {
      setError(getErrorMessage(err, t("notif.markFailed")));
    }
  }

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => reload({ page: 1, unreadOnly: false })}
            className={!unreadOnly ? btnPrimary : btnSecondary}
          >
            {t("common.all")}
          </button>
          <button
            type="button"
            onClick={() => reload({ page: 1, unreadOnly: true })}
            className={unreadOnly ? btnPrimary : btnSecondary}
          >
            {t("notif.unread")} {unreadCount > 0 ? `(${unreadCount})` : ""}
          </button>
        </div>

        {unreadCount > 0 ? (
          <button type="button" onClick={handleMarkAll} className="text-sm font-semibold text-brand-700 hover:underline">
            {t("bell.markAll")}
          </button>
        ) : null}
      </div>

      {error ? <div className={`mt-5 ${alertError}`}>{error}</div> : null}

      {loading && items.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={BellOff} title={unreadOnly ? t("notif.noneUnread") : t("notif.none")} />
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-100">
          {items.map((notification) => (
            <li key={notification.id}>
              <button
                type="button"
                onClick={() => void open(notification)}
                className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                  notification.read ? "" : "bg-brand-50/40"
                }`}
              >
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    notification.read ? "bg-transparent" : "bg-brand-500"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">{notification.title}</span>
                  <span className="mt-0.5 block text-sm text-slate-600">{notification.body}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-400">{timeAgo(notification.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Pager pagination={pagination} onPageChange={(next) => reload({ page: next })} disabled={loading} />
    </section>
  );
}

function Preferences() {
  const { t } = useI18n();
  const [preferences, setPreferences] = useState<NotificationPreference[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;

    getNotificationPreferences()
      .then((result) => {
        if (!cancelled) setPreferences(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, translate("notif.settingsLoadFailed")));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const isEnabled = (type: NotificationType, channel: NotificationChannel) =>
    preferences?.find((pref) => pref.type === type && pref.channel === channel)?.enabled ?? true;

  const toggle = (type: NotificationType, channel: NotificationChannel) => {
    setSuccess("");
    setPreferences((current) =>
      (current ?? []).map((pref) =>
        pref.type === type && pref.channel === channel ? { ...pref, enabled: !pref.enabled } : pref
      )
    );
  };

  async function handleSave() {
    if (!preferences) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      setPreferences(await updateNotificationPreferences(preferences));
      setSuccess(t("notif.saved"));
    } catch (err) {
      setError(getErrorMessage(err, t("notif.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={card}>
      <h2 className="text-lg font-semibold text-slate-900">{t("notif.settings")}</h2>
      <p className="mt-1 text-sm text-slate-500">
        {t("notif.settingsHint")}
      </p>

      {error ? <div className={`mt-5 ${alertError}`}>{error}</div> : null}
      {success ? <div className={`mt-5 ${alertSuccess}`}>{success}</div> : null}

      {preferences ? (
        <>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4">{t("notif.column")}</th>
                  {CHANNELS.map((channel) => (
                    <th key={channel} className="w-20 px-2 py-2 text-center">
                      {t(`notifChannel.${channel}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {TYPES.map((type) => (
                  <tr key={type}>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-slate-900">{t(`notifType.${type}`)}</p>
                      <p className="text-xs text-slate-500">{t(`notifHint.${type}`)}</p>
                    </td>
                    {CHANNELS.map((channel) => (
                      <td key={channel} className="px-2 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isEnabled(type, channel)}
                          onChange={() => toggle(type, channel)}
                          aria-label={`${t(`notifType.${type}`)}: ${t(`notifChannel.${channel}`)}`}
                          className="h-4 w-4 accent-brand-600"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button type="button" onClick={handleSave} disabled={saving} className={`mt-5 ${btnPrimary}`}>
            {saving ? t("common.saving") : t("notif.save")}
          </button>
        </>
      ) : !error ? (
        <p className="mt-5 text-sm text-slate-500">{t("common.loading")}</p>
      ) : null}
    </section>
  );
}

function Notifications() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={t("bell.label")} description={t("notif.subtitle")} />

      <div className="space-y-6">
        <NotificationList />
        <Preferences />
      </div>
    </div>
  );
}

export default Notifications;
