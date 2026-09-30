import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Ban, Check, CheckCheck, Clock, Download, History, Hourglass, Inbox, CalendarClock, X } from "lucide-react";
import {
  getProviderBookings,
  confirmBooking,
  completeBooking,
  cancelBooking,
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
import { alertError, btnPrimary, btnSecondary, initials, inputWidth, tableCard } from "../../lib/ui";
import { dateParts, formatDateTime, formatHours } from "../../lib/datetime";
import { downloadBookingsCsv } from "../../services/tools.api";
import { useI18n } from "../../i18n/useI18n";
import { translate } from "../../i18n/translate";

type Booking = {
  id: string;
  status: string;
  source?: "ONLINE" | "WALK_IN" | "BLOCK";
  guestName?: string | null;
  guestPhone?: string | null;
  note?: string | null;
  totalPrice?: string | null;
  refundPercent?: number | null;
  expiresAt?: string | null;
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

type Tab = Extract<BookingScope, "pending" | "upcoming" | "past">;

const btnSmall = "px-3! py-1.5!";

/** Download bookings for a date range as a spreadsheet (CSV). */
function ExportBookings() {
  const { t } = useI18n();
  const today = new Date();
  // Local calendar date (toISOString would shift to UTC, i.e. the previous day in India).
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const [from, setFrom] = useState(() => iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(() => iso(today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setBusy(true);
    setError("");
    try {
      await downloadBookingsCsv({ from, to });
    } catch (err) {
      setError(getErrorMessage(err, t("pbook.exportFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label={t("common.from")} className={`${inputWidth("w-auto")} py-2`} />
      <span aria-hidden="true" className="text-slate-400">–</span>
      <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label={t("common.to")} className={`${inputWidth("w-auto")} py-2`} />
      <button type="button" onClick={download} disabled={busy || !from || !to} className={btnSecondary}>
        <Download aria-hidden="true" className="h-4 w-4" />
        {busy ? t("pbook.preparing") : t("pbook.export")}
      </button>
      {error ? <p className="w-full text-sm text-rose-600">{error}</p> : null}
    </div>
  );
}

function Who({ booking }: { booking: Booking }) {
  const { t } = useI18n();

  if (booking.source === "BLOCK") {
    return (
      <span className="flex items-center gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <Ban className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold text-slate-900">{t("pbook.blocked")}</span>
          {booking.note ? <span className="block truncate text-sm text-slate-500">{booking.note}</span> : null}
        </span>
      </span>
    );
  }

  const name = booking.source === "WALK_IN" ? booking.guestName ?? "" : booking.user?.name || booking.user?.email || t("common.customer");
  const sub = booking.source === "WALK_IN" ? booking.guestPhone : booking.user?.email;

  return (
    <span className="flex items-center gap-3">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
        {initials(name)}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold text-slate-900">{name}</span>
          {booking.source === "WALK_IN" ? (
            <span className="shrink-0 rounded-md bg-sky-50 px-1.5 py-0.5 text-xs font-semibold text-sky-800 ring-1 ring-inset ring-sky-200">
              {t("pbook.walkInTag")}
            </span>
          ) : null}
        </span>
        {sub ? <span className="block truncate text-sm text-slate-500">{sub}</span> : null}
      </span>
    </span>
  );
}

export default function ProviderBookings() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = tabParam === "pending" || tabParam === "past" ? tabParam : "upcoming";
  const page = Number(searchParams.get("page")) || 1;
  const key = `${tab}:${page}`;

  const [result, setResult] = useState<{ key: string; bookings: Booking[]; pagination: Pagination | null; error: string }>({
    key: "",
    bookings: [],
    pagination: null,
    error: "",
  });
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const loading = result.key !== key;

  useEffect(() => {
    let cancelled = false;
    getProviderBookings({ page, scope: tab })
      .then((data) => {
        if (!cancelled) setResult({ key, bookings: data.items, pagination: data.pagination, error: "" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setResult({ key, bookings: [], pagination: null, error: getErrorMessage(err, translate("mybook.loadFailed")) });
      });
    return () => {
      cancelled = true;
    };
  }, [key, page, tab]);

  // How many requests are waiting, for the badge on the first tab.
  useEffect(() => {
    let cancelled = false;
    getProviderBookings({ scope: "pending", limit: 1 })
      .then((data) => {
        if (!cancelled) setPendingCount(data.pagination.total);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [actionLoading]);

  function show(next: { tab?: Tab; page?: number }) {
    const params = new URLSearchParams();
    const nextTab = next.tab ?? tab;
    if (nextTab !== "upcoming") params.set("tab", nextTab);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    setError("");
    setSearchParams(params);
  }

  async function act(bookingId: string, action: (id: string) => Promise<Partial<Booking>>, failure: string) {
    try {
      setActionLoading(bookingId);
      setError("");
      const updated = await action(bookingId);
      setResult((current) => ({
        ...current,
        bookings: current.bookings.map((booking) => (booking.id === bookingId ? { ...booking, ...updated } : booking)),
      }));
    } catch (err) {
      console.error(err);
      setError(getErrorMessage(err, failure));
    } finally {
      setActionLoading(null);
    }
  }

  const handleCancel = (bookingId: string) => {
    if (!window.confirm(t("pbook.confirmCancel"))) return;
    void act(bookingId, cancelBooking, t("pbook.cancelFailed"));
  };

  const shownError = error || result.error;
  const empty =
    tab === "pending"
      ? { icon: Inbox, title: t("pbook.noPending"), hint: t("pbook.noPendingHint") }
      : tab === "upcoming"
        ? { icon: CalendarClock, title: t("pbook.noUpcoming") }
        : { icon: History, title: t("pbook.noPast") };

  return (
    <div>
      <PageHeader title={t("pbook.title")} description={t("pbook.subtitle")} />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label={t("pbook.tabs")}
          value={tab}
          onChange={(next) => show({ tab: next })}
          options={[
            { value: "pending", label: pendingCount ? `${t("pbook.needsConfirm")} (${pendingCount})` : t("pbook.needsConfirm"), icon: Hourglass },
            { value: "upcoming", label: t("mybook.upcoming"), icon: CalendarClock },
            { value: "past", label: t("mybook.past"), icon: History },
          ]}
        />
        <ExportBookings />
      </div>

      {shownError ? <div className={`mb-6 ${alertError}`}>{shownError}</div> : null}

      {loading ? (
        <div className={`${tableCard} divide-y divide-slate-100`}>
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-center gap-4 p-4">
              <Skeleton className="h-14 w-14" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : result.bookings.length === 0 && !result.error ? (
        <EmptyState icon={empty.icon} title={empty.title} hint={empty.hint} />
      ) : (
        <ul className={`${tableCard} divide-y divide-slate-100`}>
          {result.bookings.map((booking) => {
            const tz = booking.venue?.timezone;
            const date = dateParts(booking.startTime, tz);
            const busy = actionLoading === booking.id;
            const inactive = ["CANCELLED", "EXPIRED"].includes(booking.status);

            return (
              <li key={booking.id} className="flex flex-col gap-4 p-4 transition hover:bg-slate-50/60 sm:px-5 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div
                    className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl ${
                      inactive ? "bg-slate-100 text-slate-500" : "bg-brand-50 text-brand-700"
                    }`}
                  >
                    <span className="text-[0.7rem] font-semibold uppercase leading-none">{date.month}</span>
                    <span className="text-xl font-bold leading-tight tabular">{date.day}</span>
                  </div>

                  <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-center">
                    <Who booking={booking} />
                    <div className="min-w-0 text-sm">
                      <p className="truncate font-medium text-slate-800">{booking.venue?.name ?? t("common.venue")}</p>
                      <p className="flex items-center gap-1.5 text-slate-500">
                        <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                        {date.weekday}, {formatHours(booking.startTime, booking.endTime, tz)}
                      </p>
                      {booking.status === "PENDING" && booking.expiresAt ? (
                        <p className="mt-0.5 flex items-center gap-1.5 font-medium text-amber-700">
                          <Hourglass aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                          {t("pbook.confirmBy", { time: formatDateTime(booking.expiresAt, tz) })}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
                  <div className="text-right">
                    {booking.totalPrice != null && booking.source !== "BLOCK" ? (
                      <p className="font-semibold text-slate-900 tabular">₹{Number(booking.totalPrice).toFixed(2)}</p>
                    ) : null}
                    {booking.status === "CANCELLED" && booking.refundPercent != null ? (
                      <p className="text-xs text-slate-500">{t("pbook.refunded", { percent: booking.refundPercent })}</p>
                    ) : null}
                  </div>
                  <StatusBadge status={booking.status} />
                  <div className="flex gap-2">
                    {booking.status === "PENDING" ? (
                      <button type="button" onClick={() => act(booking.id, confirmBooking, t("pbook.confirmFailed"))} disabled={busy} className={`${btnPrimary} ${btnSmall}`}>
                        <Check aria-hidden="true" className="h-4 w-4" />
                        {busy ? t("pbook.confirming") : t("common.confirm")}
                      </button>
                    ) : null}
                    {booking.status === "CONFIRMED" ? (
                      <button type="button" onClick={() => act(booking.id, completeBooking, t("pbook.completeFailed"))} disabled={busy} className={`${btnSecondary} ${btnSmall}`}>
                        <CheckCheck aria-hidden="true" className="h-4 w-4 text-emerald-600" />
                        {busy ? t("pbook.completing") : t("pbook.complete")}
                      </button>
                    ) : null}
                    {booking.status === "PENDING" || booking.status === "CONFIRMED" ? (
                      <button
                        type="button"
                        onClick={() => handleCancel(booking.id)}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        <X aria-hidden="true" className="h-4 w-4" />
                        {t("common.cancel")}
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Pager pagination={result.pagination} onPageChange={(next) => show({ page: next })} disabled={loading} />
    </div>
  );
}
