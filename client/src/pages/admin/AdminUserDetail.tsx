import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../../components/ui/PageHeader";
import { ApprovalBadge, AuditChanges, Badge, ReasonPrompt, UserStatusBadge } from "../../components/admin/AdminBits";
import { useLoad } from "../../hooks/useLoad";
import { getAdminUserDetail, setUserStatus, type UserStatus } from "../../services/admin.api";
import { actionLabel, rupees } from "../../lib/admin";
import { formatDateTime } from "../../lib/datetime";
import { getErrorMessage } from "../../lib/errors";
import { alertError, alertSuccess, btnDanger, btnPrimary, btnSecondary, card } from "../../lib/ui";
import StatusBadge from "../../components/ui/StatusBadge";
import { useI18n } from "../../i18n/useI18n";
import type { MessageKey } from "../../i18n/en";
import { currentLocale, translate, translateOr } from "../../i18n/translate";

const ACTIONS: Record<UserStatus, { label: MessageKey; prompt: MessageKey; placeholder: MessageKey }> = {
  SUSPENDED: { label: "auser.suspend", prompt: "auser.suspendPrompt", placeholder: "auser.suspendPlaceholder" },
  BANNED: { label: "auser.ban", prompt: "auser.banPrompt", placeholder: "auser.banPlaceholder" },
  ACTIVE: { label: "auser.reactivate", prompt: "auser.reactivatePrompt", placeholder: "auser.reactivatePlaceholder" },
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

export default function AdminUserDetail() {
  const { t } = useI18n();
  const { id = "" } = useParams();
  const { data, loading, error, reload } = useLoad(id, () => getAdminUserDetail(id), translate("auser.loadFailed"));
  const [pending, setPending] = useState<UserStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function changeStatus(status: UserStatus, reason: string) {
    setBusy(true);
    setMessage(null);
    try {
      await setUserStatus(id, status, reason);
      setMessage({
        tone: "success",
        text:
          status === "ACTIVE"
            ? t("auser.reactivated")
            : status === "BANNED"
              ? t("auser.banned")
              : t("auser.suspended"),
      });
      setPending(null);
      reload();
    } catch (err) {
      setMessage({ tone: "error", text: getErrorMessage(err, t("auser.statusFailed")) });
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div>
        <PageHeader title={t("auser.title")} description={loading ? t("common.loading") : undefined} />
        {error ? <div className={alertError}>{error}</div> : null}
      </div>
    );
  }

  const { user } = data;
  const canModerate = user.role !== "ADMIN";

  return (
    <div className={loading ? "opacity-70" : ""}>
      <Link to={user.role === "PROVIDER" ? "/admin/providers" : "/admin/users"} className="text-sm font-semibold text-brand-700 hover:underline">
        {user.role === "PROVIDER" ? t("auser.backProviders") : t("auser.backUsers")}
      </Link>

      <div className="mt-3">
        <PageHeader
          title={user.name}
          description={user.email}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={user.role === "ADMIN" ? "blue" : "grey"}>{translateOr(`role.${user.role}`, user.role)}</Badge>
              <UserStatusBadge status={user.status} />
            </div>
          }
        />
      </div>

      {message ? <div className={`mb-4 ${message.tone === "success" ? alertSuccess : alertError}`}>{message.text}</div> : null}
      {error ? <div className={`${alertError} mb-4`}>{error}</div> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className={`${card} lg:col-span-2`}>
          <h2 className="text-lg font-semibold text-slate-900">{t("auser.account")}</h2>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label={t("ausers.joined")} value={new Date(user.createdAt).toLocaleDateString(currentLocale())} />
            <Stat label={t("ausers.lastLogin")} value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString(currentLocale()) : t("ausers.never")} />
            <Stat label={t("common.email")} value={user.emailVerifiedAt ? t("auser.verified") : t("auser.notVerified")} />
            <Stat label={t("common.phone")} value={user.phone ?? "—"} />
            <Stat label={t("auser.sessions")} value={data.activeSessions} />
            <Stat label={t("auser.upcoming")} value={data.upcomingBookings} />
            <Stat label={t("nav.bookings")} value={user._count.bookings} />
            <Stat label={t("nav.reviews")} value={user._count.reviews} />
            <Stat label={t("nav.venues")} value={user._count.ownedVenues} />
          </dl>
        </section>

        <section className={card}>
          <h2 className="text-lg font-semibold text-slate-900">{t("common.status")}</h2>
          <div className="mt-3 text-sm text-slate-600">
            <UserStatusBadge status={user.status} />
            {user.statusReason ? <p className="mt-2">{t("auser.reason", { reason: user.statusReason })}</p> : null}
            {user.statusChangedAt ? (
              <p className="mt-1 text-xs text-slate-400">{t("auser.changed", { time: new Date(user.statusChangedAt).toLocaleString(currentLocale()) })}</p>
            ) : null}
          </div>

          {canModerate ? (
            <>
              {pending ? (
                <ReasonPrompt
                  title={t(ACTIONS[pending].prompt)}
                  placeholder={t(ACTIONS[pending].placeholder)}
                  confirmLabel={t(ACTIONS[pending].label)}
                  required={pending !== "ACTIVE"}
                  danger={pending !== "ACTIVE"}
                  busy={busy}
                  onConfirm={(reason) => void changeStatus(pending, reason)}
                  onCancel={() => setPending(null)}
                />
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {user.status !== "ACTIVE" ? (
                    <button type="button" onClick={() => setPending("ACTIVE")} className={btnPrimary}>
                      {t("auser.reactivate")}
                    </button>
                  ) : null}
                  {user.status !== "SUSPENDED" ? (
                    <button type="button" onClick={() => setPending("SUSPENDED")} className={btnSecondary}>
                      {t("auser.suspend")}
                    </button>
                  ) : null}
                  {user.status !== "BANNED" ? (
                    <button type="button" onClick={() => setPending("BANNED")} className={btnDanger}>
                      {t("auser.ban")}
                    </button>
                  ) : null}
                </div>
              )}
              <p className="mt-3 text-xs text-slate-400">
                {t("auser.statusHint")}
              </p>
            </>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{t("auser.adminNote")}</p>
          )}
        </section>
      </div>

      {data.venues.length > 0 ? (
        <section className={`${card} mt-6`}>
          <h2 className="text-lg font-semibold text-slate-900">{t("nav.venues")}</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {data.venues.map((venue) => (
              <li key={venue.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span>
                  <span className="font-medium text-slate-900">{venue.name}</span>
                  {venue.city ? <span className="text-slate-500"> · {venue.city}</span> : null}
                  <span className="text-slate-400"> · {t("panal.bookingsCount", { count: venue._count.bookings })}</span>
                </span>
                <span className="flex gap-2">
                  {venue.isActive ? null : <Badge tone="grey">{t("auser.unlisted")}</Badge>}
                  <ApprovalBadge status={venue.approvalStatus} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={`${card} mt-6`}>
        <h2 className="text-lg font-semibold text-slate-900">{t("cdash.recent")}</h2>
        {data.recentBookings.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t("auser.noBookings")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="py-1 pr-3">{t("abook.code")}</th>
                  <th className="py-1 pr-3">{t("common.venue")}</th>
                  <th className="py-1 pr-3">{t("detail.when")}</th>
                  <th className="py-1 pr-3">{t("common.status")}</th>
                  <th className="py-1 text-right">{t("common.price")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recentBookings.map((booking) => (
                  <tr key={booking.id}>
                    <td className="py-2 pr-3 font-mono text-xs">{booking.bookingCode ?? "—"}</td>
                    <td className="py-2 pr-3">{booking.venue.name}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-slate-500">{formatDateTime(booking.startTime, booking.venue.timezone)}</td>
                    <td className="py-2 pr-3"><StatusBadge status={booking.status} /></td>
                    <td className="py-2 text-right">{booking.totalPrice === null ? "—" : rupees(booking.totalPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`${card} mt-6`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">{t("auser.history")}</h2>
          <Link to={`/admin/audit?entityId=${user.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
            {t("auser.fullAudit")}
          </Link>
        </div>
        {data.history.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t("auser.noHistory")}</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {data.history.map((entry) => (
              <li key={entry.id} className="rounded-xl border border-slate-100 p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-900">{actionLabel(entry.action)}</span>
                  <span className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString(currentLocale())}</span>
                </div>
                <p className="text-xs text-slate-500">
                  {t("auser.by", { who: entry.actor?.name ?? entry.actorEmail ?? t("auser.system") })}
                  {entry.ip ? ` · ${entry.ip}` : ""}
                </p>
                {entry.reason ? <p className="mt-1 text-slate-600">“{entry.reason}”</p> : null}
                <AuditChanges before={entry.before} after={entry.after} />
              </li>
            ))}
          </ol>
        )}
      </section>

      {data.actionsTaken.length > 0 ? (
        <section className={`${card} mt-6`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{t("auser.actions")}</h2>
            <Link to={`/admin/audit?actorId=${user.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
              {t("auser.seeAll")}
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {data.actionsTaken.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-2 py-2">
                <span>{actionLabel(entry.action)}</span>
                <span className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString(currentLocale())}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
