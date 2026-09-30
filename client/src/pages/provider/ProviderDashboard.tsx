import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarClock, CalendarDays, ClipboardList, Clock, Hourglass, Store } from "lucide-react";
import { useAuth } from "../../context/useAuth";
import { getMyVenues } from "../../services/venue.api";
import { getProviderBookings } from "../../services/booking.api";
import PageHeader from "../../components/ui/PageHeader";
import { getErrorMessage } from "../../lib/errors";
import { alertError, initials, tableCard } from "../../lib/ui";
import { dateParts, formatHours } from "../../lib/datetime";
import StatusBadge from "../../components/ui/StatusBadge";
import { Skeleton } from "../../components/ui/Skeleton";
import { useI18n } from "../../i18n/useI18n";
import { translate } from "../../i18n/translate";
import StatCard from "../../components/ui/StatCard";
import QuickAction from "../../components/ui/QuickAction";
import EmptyState from "../../components/ui/EmptyState";

type Booking = {
  id: string;
  status: string;
  source?: "ONLINE" | "WALK_IN" | "BLOCK";
  guestName?: string | null;
  startTime: string;
  endTime: string;
  venue?: {
    name: string;
    timezone?: string;
  };
  user?: {
    name?: string;
    email?: string;
  };
};

function ProviderDashboard() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [counts, setCounts] = useState({ venues: 0, upcoming: 0, pending: 0 });
  const [next, setNext] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    // Totals come from each list's pagination, so only a handful of rows are fetched.
    Promise.all([
      getMyVenues({ limit: 1 }),
      getProviderBookings({ scope: "upcoming", limit: 5 }),
      getProviderBookings({ scope: "pending", limit: 1 }),
    ])
      .then(([venues, upcoming, pending]) => {
        if (cancelled) return;
        setCounts({ venues: venues.pagination.total, upcoming: upcoming.pagination.total, pending: pending.pagination.total });
        setNext(upcoming.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, translate("pdash.loadFailed")));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const who = (booking: Booking) =>
    booking.source === "BLOCK"
      ? t("pbook.blocked")
      : booking.source === "WALK_IN"
        ? booking.guestName ?? ""
        : booking.user?.name || booking.user?.email || t("common.customer");

  return (
    <div>
      <PageHeader
        title={t("pdash.welcome", { name: user?.name?.split(" ")[0] || t("pdash.provider") })}
        description={t("pdash.subtitle")}
      />

      {error ? <div className={`mb-6 ${alertError}`}>{error}</div> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t("nav.venues")} value={counts.venues} icon={Store} loading={loading} to="/provider/venues" />
        <StatCard label={t("pdash.upcoming")} value={counts.upcoming} icon={CalendarClock} tone="sky" loading={loading} to="/provider/bookings" />
        <StatCard label={t("pdash.pending")} value={counts.pending} icon={Hourglass} tone="amber" loading={loading} to="/provider/bookings?tab=pending" />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <QuickAction to="/provider/venues" icon={Store} title={t("nav.myVenues")} hint={t("pdash.venuesHint")} />
        <QuickAction to="/provider/time-slots" icon={CalendarClock} title={t("nav.timeSlots")} hint={t("pdash.slotsHint")} />
        <QuickAction to="/provider/bookings" icon={ClipboardList} title={t("nav.bookings")} hint={t("pdash.bookingsHint")} />
      </div>

      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{t("pdash.latest")}</h2>
          <Link to="/provider/bookings" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800">
            {t("pdash.manageAll")}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>

        {loading ? (
          <div className={`${tableCard} divide-y divide-slate-100`}>
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-center gap-4 p-4">
                <Skeleton className="h-12 w-12" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : next.length === 0 ? (
          <EmptyState icon={CalendarDays} title={t("pdash.empty")} />
        ) : (
          <ul className={`${tableCard} divide-y divide-slate-100`}>
            {next.map((booking) => {
              const tz = booking.venue?.timezone;
              const date = dateParts(booking.startTime, tz);
              return (
                <li key={booking.id} className="flex items-center gap-4 px-4 py-3 sm:px-5">
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <span className="text-[0.65rem] font-semibold uppercase leading-none">{date.month}</span>
                    <span className="text-lg font-bold leading-tight tabular">{date.day}</span>
                  </div>
                  <span aria-hidden="true" className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700 sm:flex">
                    {initials(who(booking))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{who(booking)}</p>
                    <p className="flex items-center gap-1.5 truncate text-sm text-slate-500">
                      <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                      {date.weekday}, {formatHours(booking.startTime, booking.endTime, tz)} · {booking.venue?.name ?? t("common.venue")}
                    </p>
                  </div>
                  <StatusBadge status={booking.status} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ProviderDashboard;
