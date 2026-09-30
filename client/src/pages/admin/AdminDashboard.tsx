import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../../components/ui/PageHeader";
import { ApprovalBadge, UserStatusBadge } from "../../components/admin/AdminBits";
import { useLoad } from "../../hooks/useLoad";
import { adminSearch, getAdminDashboard, type AdminSearchResults } from "../../services/admin.api";
import { formatDateTime } from "../../lib/datetime";
import { getErrorMessage } from "../../lib/errors";
import { alertError, card, cardHover, input } from "../../lib/ui";
import StatusBadge from "../../components/ui/StatusBadge";
import { useI18n } from "../../i18n/useI18n";
import { translate, translateOr } from "../../i18n/translate";
import StatCard from "../../components/ui/StatCard";
import { AlertTriangle, Ban, Building2, CalendarCheck2, CalendarX2, ClipboardList, Flag, Hourglass, MapPinned, Store, Trophy, Users } from "lucide-react";

/** One box to find any user, venue or booking (by name, email, city or booking code). */
function AdminSearch() {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ q: string; data: AdminSearchResults | null; error: string }>({ q: "", data: null, error: "" });
  const q = text.trim();

  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      adminSearch(q)
        .then((data) => {
          if (!cancelled) setResult({ q, data, error: "" });
        })
        .catch((err: unknown) => {
          if (!cancelled) setResult({ q, data: null, error: getErrorMessage(err) });
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const current = q.length >= 2 && result.q === q ? result : null;
  const empty = current?.data && !current.data.users.length && !current.data.venues.length && !current.data.bookings.length;

  return (
    <section className={`${card} mb-8`}>
      <label htmlFor="admin-search" className="text-sm font-semibold text-slate-900">{t("adash.search")}</label>
      <input
        id="admin-search"
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("adash.searchPlaceholder")}
        className={`${input} mt-2`}
        autoComplete="off"
      />

      {q.length >= 2 && !current ? <p className="mt-3 text-sm text-slate-400">{t("browse.searching")}</p> : null}
      {current?.error ? <p className={`${alertError} mt-3`}>{current.error}</p> : null}
      {empty ? <p className="mt-3 text-sm text-slate-500">{t("adash.nothing", { q })}</p> : null}

      {current?.data && !empty ? (
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("adash.people")}</p>
            <ul className="mt-1 space-y-1 text-sm">
              {current.data.users.map((user) => (
                <li key={user.id}>
                  <Link to={`/admin/users/${user.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">{user.name}</Link>{" "}
                  <span className="text-xs text-slate-400">{translateOr(`role.${user.role}`, user.role.toLowerCase())}</span>
                  {user.status !== "ACTIVE" ? <> <UserStatusBadge status={user.status} /></> : null}
                  <span className="block truncate text-xs text-slate-500">{user.email}</span>
                </li>
              ))}
              {current.data.users.length === 0 ? <li className="text-slate-400">—</li> : null}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("nav.venues")}</p>
            <ul className="mt-1 space-y-1 text-sm">
              {current.data.venues.map((venue) => (
                <li key={venue.id}>
                  <Link to={`/admin/venues?status=ALL&q=${encodeURIComponent(venue.name)}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">{venue.name}</Link>
                  <span className="block text-xs text-slate-500">
                    {venue.city ?? t("adash.noCity")} {venue.approvalStatus !== "APPROVED" ? <ApprovalBadge status={venue.approvalStatus} /> : null}
                  </span>
                </li>
              ))}
              {current.data.venues.length === 0 ? <li className="text-slate-400">—</li> : null}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("nav.bookings")}</p>
            <ul className="mt-1 space-y-1 text-sm">
              {current.data.bookings.map((booking) => (
                <li key={booking.id}>
                  <Link to={`/admin/bookings?q=${encodeURIComponent(booking.bookingCode ?? booking.id)}`} className="font-mono text-xs font-semibold text-slate-900 hover:text-brand-700 hover:underline">
                    {booking.bookingCode ?? booking.id.slice(0, 8)}
                  </Link>{" "}
                  <StatusBadge status={booking.status} />
                  <span className="block text-xs text-slate-500">
                    {booking.user.name} · {booking.venue.name} · {formatDateTime(booking.startTime, booking.venue.timezone)}
                  </span>
                </li>
              ))}
              {current.data.bookings.length === 0 ? <li className="text-slate-400">—</li> : null}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AdminDashboard() {
  const { t } = useI18n();
  const { data: dashboard, loading, error } = useLoad("dashboard", getAdminDashboard, translate("adash.loadFailed"));

  if (!dashboard) {
    return (
      <div>
        <PageHeader title={t("adash.title")} description={loading ? t("adash.loading") : undefined} />
        {error ? <div className={alertError}>{error}</div> : null}
      </div>
    );
  }

  const queues = [
    { title: t("adash.qVenues"), value: dashboard.queues.venuesAwaitingApproval, to: "/admin/venues", icon: Store },
    { title: t("adash.qReviews"), value: dashboard.queues.flaggedReviews, to: "/admin/reviews", icon: Flag },
    { title: t("adash.qUsers"), value: dashboard.queues.suspendedUsers, to: "/admin/users?status=SUSPENDED", icon: Ban },
  ];

  const overviewCards = [
    { title: t("nav.users"), value: dashboard.users, icon: Users },
    { title: t("nav.providers"), value: dashboard.providers, icon: Building2 },
    { title: t("nav.venues"), value: dashboard.venues, icon: MapPinned },
    { title: t("nav.bookings"), value: dashboard.bookings, icon: ClipboardList },
  ];

  const bookingCards = [
    { title: t("adash.statPending"), value: dashboard.bookingStats.pending, icon: Hourglass, tone: "amber" as const },
    { title: t("adash.statConfirmed"), value: dashboard.bookingStats.confirmed, icon: CalendarCheck2, tone: "green" as const },
    { title: t("adash.statCompleted"), value: dashboard.bookingStats.completed, icon: Trophy, tone: "sky" as const },
    { title: t("adash.statCancelled"), value: dashboard.bookingStats.cancelled, icon: CalendarX2, tone: "rose" as const },
  ];

  return (
    <div>
      <PageHeader title={t("adash.title")} description={t("adash.subtitle")} />

      <AdminSearch />

      <h2 className="mb-4 text-lg font-semibold text-slate-900">{t("adash.attention")}</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {queues.map((queue) => (
          <Link
            key={queue.title}
            to={queue.to}
            className={`${cardHover} flex items-center gap-4 ${queue.value > 0 ? "border-amber-200 bg-amber-50/40" : ""}`}
          >
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${queue.value > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
              {queue.value > 0 ? <AlertTriangle className="h-5 w-5" aria-hidden /> : <queue.icon className="h-5 w-5" aria-hidden />}
            </span>
            <span>
              <span className="tabular block text-2xl font-bold text-slate-900">{queue.value}</span>
              <span className="block text-sm text-slate-500">{queue.title}</span>
            </span>
          </Link>
        ))}
      </div>

      <h2 className="mb-4 mt-8 text-lg font-semibold text-slate-900">{t("adash.overview")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {overviewCards.map((cardItem) => (
          <StatCard key={cardItem.title} label={cardItem.title} value={cardItem.value} icon={cardItem.icon} />
        ))}
      </div>

      <h2 className="mb-4 mt-8 text-lg font-semibold text-slate-900">{t("adash.stats")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {bookingCards.map((cardItem) => (
          <StatCard key={cardItem.title} label={cardItem.title} value={cardItem.value} icon={cardItem.icon} tone={cardItem.tone} />
        ))}
      </div>
    </div>
  );
}

export default AdminDashboard;
