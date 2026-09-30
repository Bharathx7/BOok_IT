import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  BellRing,
  CalendarCheck,
  CalendarClock,
  ChevronRight,
  Clock,
  History,
  Hourglass,
  MapPin,
  Plus,
  RotateCcw,
  Star,
  X,
} from "lucide-react";
import {
  cancelBooking,
  getBookings,
  type Booking,
  type BookingScope,
} from "../../services/booking.api";
import PageHeader from "../../components/ui/PageHeader";
import Pager from "../../components/ui/Pager";
import SegmentedControl from "../../components/ui/SegmentedControl";
import EmptyState from "../../components/ui/EmptyState";
import StatusBadge from "../../components/ui/StatusBadge";
import { Skeleton } from "../../components/ui/Skeleton";
import { getErrorMessage } from "../../lib/errors";
import type { Pagination } from "../../lib/pagination";
import { alertError, btnDanger, btnPrimary, btnSecondary, card } from "../../lib/ui";
import { dateParts, formatDateTime, formatHours, formatTimeRange } from "../../lib/datetime";
import { getCancellationQuote } from "../../services/tools.api";
import { getMyWaitlist, leaveWaitlist, type WaitlistEntry } from "../../services/features.api";
import { useI18n } from "../../i18n/useI18n";
import { translate } from "../../i18n/translate";

// Compact buttons for the booking cards; "!" beats the base button padding.
const btnSmall = "px-3! py-2!";

/** Times the customer is queueing for. */
function MyWaitlist() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    getMyWaitlist()
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (entries.length === 0) return null;

  return (
    <section className={`${card} mb-6`}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <BellRing aria-hidden="true" className="h-4 w-4 text-brand-600" />
        {t("mybook.waitlist")}
      </h2>
      <ul className="mt-3 divide-y divide-slate-100 text-sm">
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <Link to={`/customer/venues/${entry.venueId}`} className="font-semibold text-slate-900 hover:text-brand-700">
                {entry.venue.name}
              </Link>
              <p className="text-slate-500">{formatTimeRange(entry.startTime, entry.endTime, entry.venue.timezone)}</p>
            </div>
            <div className="flex items-center gap-2">
              {entry.status === "NOTIFIED" ? (
                <>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
                    {t("mybook.freeNow")}
                  </span>
                  <Link to={`/customer/venues/${entry.venueId}`} className={`${btnPrimary} ${btnSmall}`}>
                    {t("mybook.bookIt")}
                  </Link>
                </>
              ) : null}
              <button
                type="button"
                onClick={async () => {
                  await leaveWaitlist(entry.id);
                  setEntries((current) => current.filter((e) => e.id !== entry.id));
                }}
                className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                {t("mybook.leave")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Notice({ icon: Icon, tone, children }: { icon: typeof Clock; tone: "amber" | "slate"; children: React.ReactNode }) {
  return (
    <p className={`mt-2 flex items-start gap-1.5 text-sm ${tone === "amber" ? "text-amber-800" : "text-slate-500"}`}>
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function BookingCard({
  booking,
  cancelling,
  onCancel,
}: {
  booking: Booking;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const tz = booking.venue.timezone;
  const date = dateParts(booking.startTime, tz);
  const detail = `/customer/bookings/${booking.id}`;
  const inactive = ["CANCELLED", "EXPIRED"].includes(booking.status);
  const price =
    booking.totalPrice !== null
      ? `₹${Number(booking.totalPrice).toFixed(2)}`
      : `₹${booking.venue.pricePerHour}${t("common.perHour")}`;

  return (
    <article className="group flex overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card transition hover:border-brand-200 hover:shadow-raised">
      <div
        className={`flex w-20 shrink-0 flex-col items-center justify-center border-r border-dashed py-4 sm:w-24 ${
          inactive ? "border-slate-200 bg-slate-50 text-slate-500" : "border-brand-200 bg-brand-50 text-brand-700"
        }`}
      >
        <span className="text-xs font-semibold uppercase tracking-wider">{date.month}</span>
        <span className="text-3xl font-bold leading-tight tabular">{date.day}</span>
        <span className="text-xs font-medium">{date.weekday}</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
              <Link to={detail} className="hover:text-brand-700">
                {booking.venue.name}
              </Link>
            </h2>
            <StatusBadge status={booking.status} />
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <Clock aria-hidden="true" className="h-4 w-4 text-slate-400" />
            {formatHours(booking.startTime, booking.endTime, tz)}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
            <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="truncate">{booking.venue.address || t("venue.noAddress")}</span>
          </p>

          {booking.status === "PENDING" && booking.expiresAt ? (
            <Notice icon={Hourglass} tone="amber">
              {t("mybook.waitingConfirm", { time: formatDateTime(booking.expiresAt, tz) })}
            </Notice>
          ) : null}
          {booking.status === "AWAITING_PAYMENT" && booking.expiresAt ? (
            <Notice icon={AlertCircle} tone="amber">
              {t("pay.completePayment", { time: formatDateTime(booking.expiresAt, tz) })}
            </Notice>
          ) : null}
          {booking.status === "EXPIRED" ? <Notice icon={History} tone="slate">{t("mybook.expired")}</Notice> : null}
          {booking.status === "CANCELLED" && booking.refundPercent !== null ? (
            <Notice icon={RotateCcw} tone="slate">
              {t("mybook.refund", { percent: booking.refundPercent })}
              {booking.refundAmount !== null ? ` (₹${Number(booking.refundAmount).toFixed(2)})` : ""}
            </Notice>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 sm:flex-col sm:items-end">
          <p className="text-lg font-bold text-slate-900 tabular">{price}</p>
          <div className="flex flex-wrap gap-2">
            {booking.status === "AWAITING_PAYMENT" ? (
              <Link to={detail} className={`${btnPrimary} ${btnSmall}`}>
                {t("mybook.payNow")}
              </Link>
            ) : null}
            {booking.status === "COMPLETED" && !booking.review ? (
              <Link to="/customer/reviews" className={`${btnSecondary} ${btnSmall}`}>
                <Star aria-hidden="true" className="h-4 w-4 text-amber-500" />
                {t("mybook.rate")}
              </Link>
            ) : null}
            {booking.status === "PENDING" || booking.status === "CONFIRMED" ? (
              <button type="button" onClick={onCancel} disabled={cancelling} className={`${btnDanger} ${btnSmall}`}>
                <X aria-hidden="true" className="h-4 w-4" />
                {cancelling ? t("mybook.cancelling") : t("mybook.cancel")}
              </button>
            ) : null}
            <Link to={detail} className={`${btnSecondary} ${btnSmall}`}>
              {t("mybook.view")}
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

function BookingSkeleton() {
  return (
    <div className="flex overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <Skeleton className="h-28 w-20 rounded-none sm:w-24" />
      <div className="flex-1 space-y-3 p-5">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/5" />
      </div>
    </div>
  );
}

function MyBookings() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const scope: BookingScope = searchParams.get("tab") === "past" ? "past" : "upcoming";
  const page = Number(searchParams.get("page")) || 1;
  const key = `${scope}:${page}`;

  const [result, setResult] = useState<{ key: string; bookings: Booking[]; pagination: Pagination | null; error: string }>({
    key: "",
    bookings: [],
    pagination: null,
    error: "",
  });
  const [error, setError] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const loading = result.key !== key;

  useEffect(() => {
    let cancelled = false;
    getBookings({ page, scope })
      .then((data) => {
        if (!cancelled) setResult({ key, bookings: data.items, pagination: data.pagination, error: "" });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResult({ key, bookings: [], pagination: null, error: getErrorMessage(err, translate("mybook.loadFailed")) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, page, scope]);

  function show(next: { tab?: BookingScope; page?: number }) {
    const params = new URLSearchParams();
    const tab = next.tab ?? scope;
    if (tab === "past") params.set("tab", "past");
    if (next.page && next.page > 1) params.set("page", String(next.page));
    setError("");
    setSearchParams(params);
  }

  const handleCancel = async (bookingId: string) => {
    // Show what the venue's cancellation policy refunds before confirming.
    let refundText = "";
    try {
      const quote = await getCancellationQuote(bookingId);
      refundText =
        quote.refundPercent === 100
          ? `\n\n${t("mybook.fullRefund")}`
          : `\n\n${t("mybook.partialRefund", { percent: quote.refundPercent, amount: quote.refundAmount.toFixed(2) })}`;
    } catch {
      // Still allow cancelling if the quote fails.
    }

    if (!window.confirm(`${t("mybook.confirmCancel")}${refundText}`)) {
      return;
    }

    try {
      setCancellingId(bookingId);
      setError("");
      const updatedBooking = await cancelBooking(bookingId);
      setResult((current) => ({
        ...current,
        bookings: current.bookings.map((booking) =>
          booking.id === bookingId ? { ...booking, ...updatedBooking, venue: booking.venue } : booking
        ),
      }));
    } catch (err) {
      console.error("Failed to cancel booking:", err);
      setError(getErrorMessage(err, t("mybook.cancelFailed")));
    } finally {
      setCancellingId(null);
    }
  };

  const shownError = error || result.error;

  return (
    <div>
      <PageHeader
        title={t("nav.myBookings")}
        description={t("mybook.subtitle")}
        action={
          <Link to="/customer/venues" className={btnPrimary}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            {t("mybook.book")}
          </Link>
        }
      />

      <MyWaitlist />

      <div className="mb-5">
        <SegmentedControl
          label={t("mybook.show")}
          value={scope}
          onChange={(tab) => show({ tab })}
          options={[
            { value: "upcoming", label: t("mybook.upcoming"), icon: CalendarClock },
            { value: "past", label: t("mybook.past"), icon: History },
          ]}
        />
      </div>

      {shownError ? <div className={`mb-6 ${alertError}`}>{shownError}</div> : null}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, index) => (
            <BookingSkeleton key={index} />
          ))}
        </div>
      ) : result.bookings.length === 0 && !result.error ? (
        scope === "upcoming" ? (
          <EmptyState
            icon={CalendarCheck}
            title={t("mybook.noUpcoming")}
            hint={t("mybook.noUpcomingHint")}
            action={<Link to="/customer/venues" className={btnPrimary}>{t("cdash.browse")}</Link>}
          />
        ) : (
          <EmptyState icon={History} title={t("mybook.noPast")} hint={t("mybook.noPastHint")} />
        )
      ) : (
        <div className="space-y-4">
          {result.bookings.map((booking) => (
            <BookingCard
              key={booking.id}
              booking={booking}
              cancelling={cancellingId === booking.id}
              onCancel={() => handleCancel(booking.id)}
            />
          ))}
        </div>
      )}

      <Pager pagination={result.pagination} onPageChange={(next) => show({ page: next })} disabled={loading} />
    </div>
  );
}

export default MyBookings;
