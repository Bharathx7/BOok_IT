import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/useAuth";
import { getBookings, type Booking } from "../../services/booking.api";
import { getErrorMessage } from "../../lib/errors";
import { fetchAllPages } from "../../lib/pagination";
import { alertError, btnPrimary, card } from "../../lib/ui";
import { formatDateTime } from "../../lib/datetime";
import StatusBadge from "../../components/ui/StatusBadge";
import { useI18n } from "../../i18n/useI18n";
import { translate } from "../../i18n/translate";
import StatCard from "../../components/ui/StatCard";
import QuickAction from "../../components/ui/QuickAction";
import { CalendarCheck2, CalendarDays, CalendarRange, Search, Star, Trophy } from "lucide-react";
import EmptyState from "../../components/ui/EmptyState";

function CustomerDashboard() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await fetchAllPages(getBookings);
        setBookings(data);
      } catch (err) {
        console.error(err);
        setError(getErrorMessage(err, translate("cdash.loadFailed")));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const upcoming = bookings.filter(
    (booking) => booking.status === "PENDING" || booking.status === "CONFIRMED"
  );
  const completed = bookings.filter((booking) => booking.status === "COMPLETED");

  return (
    <div>
      <section className="relative mb-8 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-6 text-white shadow-raised sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 right-40 h-56 w-56 rounded-full bg-sky-400/20 blur-3xl" aria-hidden />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {t("cdash.hello", { name: user?.name?.split(" ")[0] || t("cdash.there") })}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-indigo-100">{t("cdash.subtitle")}</p>
          </div>
          <Link
            to="/customer/venues"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 shadow-card transition hover:bg-brand-50"
          >
            <Search className="h-4 w-4" aria-hidden />
            {t("cdash.browse")}
          </Link>
        </div>
      </section>

      {error ? <div className={`mb-6 ${alertError}`}>{error}</div> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t("cdash.total")} value={bookings.length} icon={CalendarRange} loading={loading} />
        <StatCard label={t("cdash.upcoming")} value={upcoming.length} icon={CalendarCheck2} tone="green" loading={loading} />
        <StatCard label={t("cdash.completed")} value={completed.length} icon={Trophy} tone="sky" loading={loading} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <QuickAction to="/customer/venues" icon={Search} title={t("cdash.find")} hint={t("cdash.findHint")} />
        <QuickAction to="/customer/bookings" icon={CalendarDays} title={t("cdash.bookings")} hint={t("cdash.bookingsHint")} />
        <QuickAction to="/customer/reviews" icon={Star} title={t("cdash.review")} hint={t("cdash.reviewHint")} />
      </div>

      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{t("cdash.recent")}</h2>
          <Link to="/customer/bookings" className="text-sm font-semibold text-brand-700">
            {t("common.viewAll")}
          </Link>
        </div>

        {loading ? (
          <div className={card}>
            <p className="text-sm text-slate-500">{t("cdash.loading")}</p>
          </div>
        ) : bookings.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={t("cdash.empty")}
            action={<Link to="/customer/venues" className={btnPrimary}>{t("cdash.browse")}</Link>}
          />
        ) : (
          <div className="space-y-3">
            {bookings.slice(0, 4).map((booking) => (
              <div key={booking.id} className={`${card} flex items-center justify-between gap-4`}>
                <div>
                  <p className="font-semibold text-slate-900">{booking.venue.name}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatDateTime(booking.startTime, booking.venue.timezone)}
                  </p>
                </div>
                <StatusBadge status={booking.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CustomerDashboard;
