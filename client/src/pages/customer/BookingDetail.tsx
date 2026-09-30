import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRightLeft,
  CalendarRange,
  CheckCircle2,
  Circle,
  Clock,
  CreditCard,
  Hourglass,
  MapPin,
  Repeat,
  RotateCcw,
  ScanLine,
  Send,
  Tag,
  UserPlus,
  UserX,
  Users,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import BookingPicker from "../../components/venue/BookingPicker";
import { Skeleton } from "../../components/ui/Skeleton";
import { useAuth } from "../../context/useAuth";
import { cancelBooking } from "../../services/booking.api";
import {
  cancelSeries,
  getBookingDetail,
  inviteParticipants,
  removeParticipant,
  rescheduleBooking,
  type BookingDetail as Detail,
} from "../../services/features.api";
import { getCancellationQuote } from "../../services/tools.api";
import { getVenueById, type VenueDetails } from "../../services/venue.api";
import { dateParts, formatDate, formatDateTime, formatHours, timeAgo } from "../../lib/datetime";
import { alertError, alertSuccess, btnDanger, btnPrimary, btnSecondary, card, initials, input } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import StatusBadge from "../../components/ui/StatusBadge";
import { useI18n } from "../../i18n/useI18n";
import { translate, translateOr } from "../../i18n/translate";
import { CheckoutClosedError, payOrder } from "../../lib/checkout";
import { startPayment, type PaymentSummary } from "../../services/payment.api";
import { rupees } from "../../lib/admin";

const TIMELINE_ICONS: Record<string, LucideIcon> = {
  Requested: Send,
  Paid: CreditCard,
  "Checked in": ScanLine,
  Completed: CheckCircle2,
  Cancelled: XCircle,
  Refunded: RotateCcw,
  "Marked as no-show": UserX,
  "Moved to another time": ArrowRightLeft,
  "Moved here from an earlier time": ArrowRightLeft,
};

/** The QR code styled as a ticket stub. */
function Ticket({ code }: { code: string }) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(code, { margin: 1, width: 240, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-raised">
      <div className="bg-gradient-to-br from-brand-600 to-indigo-500 px-5 py-4 text-white">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <ScanLine aria-hidden="true" className="h-4 w-4" />
          {t("detail.ticket")}
        </p>
        <p className="mt-0.5 text-xs text-indigo-100">{t("detail.qrHint")}</p>
      </div>
      <div className="flex justify-center px-5 pb-4 pt-6">
        {src ? (
          <img src={src} alt={t("detail.qrAlt", { code })} className="h-48 w-48 rounded-xl bg-white p-1 ring-1 ring-slate-200" />
        ) : (
          <div className="h-48 w-48 animate-pulse rounded-xl bg-slate-100" />
        )}
      </div>
      {/* Perforation: a dashed line with notches cut into both edges. */}
      <div aria-hidden="true" className="relative mx-5 border-t-2 border-dashed border-slate-200">
        <span className="absolute -left-8 -top-3 h-6 w-6 rounded-full border border-slate-200 bg-canvas" />
        <span className="absolute -right-8 -top-3 h-6 w-6 rounded-full border border-slate-200 bg-canvas" />
      </div>
      <p className="px-5 py-4 text-center font-mono text-2xl font-bold tracking-[0.3em] text-slate-900">{code}</p>
    </section>
  );
}

function Participants({ booking, onChange }: { booking: Detail; onChange: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const upcoming = ["PENDING", "CONFIRMED"].includes(booking.status) && new Date(booking.endTime) > new Date();

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setStatus(null);
    try {
      await inviteParticipants(booking.id, [{ email: email.trim(), ...(name.trim() && { name: name.trim() }) }]);
      setEmail("");
      setName("");
      setStatus({ tone: "success", text: t("detail.inviteSent") });
      onChange();
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    }
  }

  const badge: Record<string, string> = {
    INVITED: "bg-amber-50 text-amber-800 ring-amber-200",
    ACCEPTED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    DECLINED: "bg-slate-100 text-slate-600 ring-slate-200",
  };

  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
        <Users aria-hidden="true" className="h-5 w-5 text-slate-400" />
        {t("detail.players")}
      </h2>
      <ul className="mt-4 space-y-3 text-sm">
        <li className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
            {initials(booking.user.name)}
          </span>
          <span className="font-semibold text-slate-900">
            {booking.user.name} <span className="font-normal text-slate-500">{t("detail.organiser")}</span>
          </span>
        </li>
        {booking.participants.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-3">
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                {initials(p.name || p.email)}
              </span>
              <span className="min-w-0">
                {p.name ? <span className="block truncate font-medium text-slate-900">{p.name}</span> : null}
                <span className="block truncate text-slate-500">{p.email}</span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${badge[p.status]}`}>
                {translateOr(`participant.${p.status}`, p.status.toLowerCase())}
              </span>
              {booking.canManage && upcoming ? (
                <button
                  type="button"
                  onClick={async () => {
                    await removeParticipant(booking.id, p.id);
                    onChange();
                  }}
                  aria-label={`${t("common.remove")} ${p.name || p.email}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {booking.canManage && upcoming ? (
        <form onSubmit={handleInvite} className="mt-5 rounded-xl bg-slate-50 p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <UserPlus aria-hidden="true" className="h-4 w-4 text-brand-600" />
            {t("detail.inviteFriend")}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="friend@example.com"
              className={input}
              aria-label={t("detail.friendEmail")}
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("detail.namePlaceholder")}
              className={input}
              aria-label={t("detail.friendName")}
            />
            <button type="submit" className={`${btnPrimary} shrink-0`}>
              {t("detail.invite")}
            </button>
          </div>
        </form>
      ) : null}
      {status ? <div className={`mt-3 ${status.tone === "success" ? alertSuccess : alertError}`}>{status.text}</div> : null}
    </section>
  );
}

function Payments({ payments, timeZone }: { payments: PaymentSummary[]; timeZone: string }) {
  const { t } = useI18n();
  const captured = payments.filter((payment) => payment.capturedAt);
  const failed = payments.find((payment) => payment.status === "FAILED");
  if (captured.length === 0 && !failed) return null;

  return (
    <section className={card}>
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
        <CreditCard aria-hidden="true" className="h-5 w-5 text-slate-400" />
        {t("pay.section")}
      </h2>
      <ul className="mt-3 space-y-2 text-sm text-slate-700">
        {captured.map((payment) => (
          <li key={payment.id} className="flex gap-2">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>
              {payment.method
                ? t("pay.paidWith", { amount: rupees(payment.amountPaise / 100), method: payment.method.toUpperCase(), time: formatDateTime(payment.capturedAt!, timeZone) })
                : t("pay.paid", { amount: rupees(payment.amountPaise / 100), time: formatDateTime(payment.capturedAt!, timeZone) })}
              {payment.refunds.map((refund) => (
                <span key={refund.id} className="mt-1 flex items-center gap-1.5 text-slate-500">
                  <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                  {t("pay.refundLine", { amount: rupees(refund.amountPaise / 100), status: t(`pay.refund.${refund.status}`) })}
                </span>
              ))}
            </span>
          </li>
        ))}
        {captured.length === 0 && failed?.failureReason ? (
          <li className="flex gap-2 text-rose-700">
            <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            {t("pay.failedAttempt", { reason: failed.failureReason })}
          </li>
        ) : null}
      </ul>
      {captured.some((payment) => payment.refunds.length > 0) ? <p className="mt-3 text-xs text-slate-500">{t("pay.refundHint")}</p> : null}
    </section>
  );
}

function BookingDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useI18n();
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{ key: string; booking: Detail | null; error: string }>({ key: "", booking: null, error: "" });
  const [venue, setVenue] = useState<VenueDetails | null>(null);
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const key = `${id}:${reload}`;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getBookingDetail(id)
      .then((booking) => {
        if (!cancelled) setState({ key, booking, error: "" });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ key, booking: null, error: getErrorMessage(error, translate("detail.loadFailed")) });
      });
    return () => {
      cancelled = true;
    };
  }, [id, key]);

  const booking = state.booking;
  const refresh = () => setReload((value) => value + 1);

  async function handlePay() {
    if (!booking) return;
    setBusy(true);
    setMessage(null);
    try {
      const paid = await payOrder(await startPayment(booking.id));
      setMessage({ tone: "success", text: paid.status === "CONFIRMED" ? t("pay.done") : t("pay.pending") });
    } catch (error) {
      setMessage(
        error instanceof CheckoutClosedError
          ? { tone: "error", text: t("pay.closed") }
          : { tone: "error", text: getErrorMessage(error) }
      );
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function startMoving() {
    if (!booking) return;
    setMessage(null);
    try {
      setVenue(await getVenueById(booking.venueId));
      setMoving(true);
    } catch (error) {
      setMessage({ tone: "error", text: getErrorMessage(error) });
    }
  }

  async function handleCancel() {
    if (!booking) return;
    let refundText = "";
    try {
      const quote = await getCancellationQuote(booking.id);
      refundText =
        quote.refundPercent === 100
          ? `\n\n${t("mybook.fullRefund")}`
          : `\n\n${t("detail.refundSome", { percent: quote.refundPercent, amount: quote.refundAmount.toFixed(2) })}`;
    } catch {
      // Still allow cancelling.
    }
    if (!window.confirm(`${t("detail.confirmCancel")}${refundText}`)) return;

    setBusy(true);
    try {
      await cancelBooking(booking.id);
      refresh();
    } catch (error) {
      setMessage({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelSeries() {
    if (!booking?.recurringGroupId || !window.confirm(t("detail.confirmSeries"))) return;
    setBusy(true);
    try {
      const { cancelled } = await cancelSeries(booking.recurringGroupId);
      setMessage({ tone: "success", text: cancelled === 1 ? t("detail.seriesCancelledOne") : t("detail.seriesCancelled", { count: cancelled }) });
      refresh();
    } catch (error) {
      setMessage({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  const backLink = (
    <Link to="/customer/bookings" className="mb-5 inline-flex items-center gap-1.5 py-1 text-sm font-semibold text-slate-600 transition hover:text-brand-700">
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      {t("nav.myBookings")}
    </Link>
  );

  if (state.key !== key && !booking) {
    return (
      <div>
        {backLink}
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-56" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }
  if (state.error || !booking) {
    return (
      <div>
        {backLink}
        <div className={alertError}>{state.error || t("detail.notFound")}</div>
      </div>
    );
  }

  const tz = booking.venue.timezone;
  const date = dateParts(booking.startTime, tz);
  const active = ["PENDING", "CONFIRMED"].includes(booking.status);
  const inactive = ["CANCELLED", "EXPIRED"].includes(booking.status);
  const upcomingSeries = booking.series.filter((b) => ["PENDING", "CONFIRMED"].includes(b.status) && new Date(b.startTime) > new Date());
  const place = [booking.venue.address, booking.venue.city].filter(Boolean).join(", ") || booking.venue.name;
  const showTicket = Boolean(booking.bookingCode && active && booking.userId === user?.id);

  return (
    <div>
      {backLink}

      {message ? <div className={`mb-4 ${message.tone === "success" ? alertSuccess : alertError}`}>{message.text}</div> : null}

      {booking.rescheduledTo ? (
        <div className={`mb-4 flex flex-wrap items-center gap-2 ${alertSuccess}`}>
          <ArrowRightLeft aria-hidden="true" className="h-4 w-4" />
          {t("detail.moved")}
          <Link to={`/customer/bookings/${booking.rescheduledTo.id}`} className="font-semibold underline">
            {t("detail.seeNew")}
          </Link>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
        <div className="flex flex-col sm:flex-row">
          <div
            className={`flex shrink-0 items-center gap-3 px-6 py-5 sm:w-36 sm:flex-col sm:justify-center sm:gap-0 sm:border-r sm:border-dashed ${
              inactive ? "bg-slate-50 text-slate-500 sm:border-slate-200" : "bg-brand-50 text-brand-700 sm:border-brand-200"
            }`}
          >
            <span className="text-sm font-semibold uppercase tracking-wider">{date.month}</span>
            <span className="text-4xl font-bold leading-tight tabular sm:text-5xl">{date.day}</span>
            <span className="text-sm font-medium">{date.weekday}</span>
          </div>

          <div className="flex-1 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={booking.status} />
                  {booking.checkedInAt ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
                      <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                      {t("detail.checkedIn", { time: formatDateTime(booking.checkedInAt, tz) })}
                    </span>
                  ) : null}
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                  <Link to={`/customer/venues/${booking.venueId}`} className="hover:text-brand-700">
                    {booking.venue.name}
                  </Link>
                </h1>
                <p className="mt-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                  <Clock aria-hidden="true" className="h-4 w-4 text-slate-400" />
                  {formatDate(booking.startTime, tz)} · {formatHours(booking.startTime, booking.endTime, tz)}
                </p>
                <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                  <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
                  {place}
                </p>
              </div>

              {booking.totalPrice !== null ? (
                <div className="text-left sm:text-right">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{t("common.total")}</p>
                  <p className="text-2xl font-bold text-slate-900 tabular">₹{Number(booking.totalPrice).toFixed(2)}</p>
                  {booking.coupon && booking.discountAmount ? (
                    <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <Tag aria-hidden="true" className="h-3.5 w-3.5" />
                      {t("detail.afterDiscount", { amount: Number(booking.discountAmount).toFixed(2), code: booking.coupon.code })}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {booking.status === "PENDING" && booking.expiresAt ? (
              <p className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <Hourglass aria-hidden="true" className="h-4 w-4 shrink-0" />
                {t("detail.confirmsBy")}: <span className="font-semibold">{formatDateTime(booking.expiresAt, tz)}</span>
              </p>
            ) : null}
            {booking.refundPercent !== null ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-slate-600">
                <RotateCcw aria-hidden="true" className="h-4 w-4 text-slate-400" />
                {t("detail.refund")}: <span className="font-semibold text-slate-900">{booking.refundPercent}%{booking.refundAmount ? ` (₹${Number(booking.refundAmount).toFixed(2)})` : ""}</span>
              </p>
            ) : null}

            {booking.canManage && booking.status === "AWAITING_PAYMENT" ? (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="flex items-start gap-2 text-sm text-amber-900">
                  <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  {t("pay.awaiting", {
                    amount: rupees(Number(booking.totalPrice ?? 0)),
                    time: booking.expiresAt ? formatDateTime(booking.expiresAt, tz) : "—",
                  })}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void handlePay()} disabled={busy} className={btnPrimary}>
                    <CreditCard aria-hidden="true" className="h-4 w-4" />
                    {busy ? t("pay.paying") : t("pay.payNow", { amount: rupees(Number(booking.totalPrice ?? 0)) })}
                  </button>
                  <button type="button" onClick={handleCancel} disabled={busy} className={btnSecondary}>
                    {t("mybook.cancel")}
                  </button>
                </div>
              </div>
            ) : null}

            {booking.canManage && active ? (
              <div className="mt-5 border-t border-slate-100 pt-5">
                <div className="flex flex-wrap gap-2">
                  {booking.canReschedule ? (
                    <button type="button" onClick={startMoving} className={btnPrimary}>
                      <ArrowRightLeft aria-hidden="true" className="h-4 w-4" />
                      {t("detail.move")}
                    </button>
                  ) : null}
                  <button type="button" onClick={handleCancel} disabled={busy} className={btnDanger}>
                    <X aria-hidden="true" className="h-4 w-4" />
                    {t("mybook.cancel")}
                  </button>
                  {upcomingSeries.length > 1 ? (
                    <button type="button" onClick={handleCancelSeries} disabled={busy} className={btnSecondary}>
                      <Repeat aria-hidden="true" className="h-4 w-4" />
                      {t("detail.cancelSeries")}
                    </button>
                  ) : null}
                </div>
                {!booking.canReschedule ? <p className="mt-2 text-xs text-slate-500">{t("detail.moveRule")}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {moving && venue ? (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">{t("detail.pickNew")}</h2>
                <button
                  type="button"
                  onClick={() => setMoving(false)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                  {t("common.close")}
                </button>
              </div>
              <BookingPicker
                venue={venue}
                ignore={{ startTime: booking.startTime, endTime: booking.endTime }}
                actionLabel={t("detail.moveHere")}
                onChoose={async (startTime, endTime) => {
                  const moved = await rescheduleBooking(booking.id, startTime, endTime);
                  setMoving(false);
                  navigate(`/customer/bookings/${moved.id}`);
                  return t("detail.movedDone");
                }}
              />
            </div>
          ) : null}

          {booking.canManage ? <Payments payments={booking.payments} timeZone={tz} /> : null}

          <Participants booking={booking} onChange={refresh} />

          {booking.series.length > 1 ? (
            <section className={card}>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                <CalendarRange aria-hidden="true" className="h-5 w-5 text-slate-400" />
                {t("detail.series")}
              </h2>
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {booking.series.map((b) => (
                  <li key={b.id}>
                    <Link
                      to={`/customer/bookings/${b.id}`}
                      aria-current={b.id === booking.id ? "page" : undefined}
                      className={`-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition hover:bg-slate-50 ${
                        b.id === booking.id ? "bg-brand-50 font-semibold text-brand-800" : "text-slate-700"
                      }`}
                    >
                      {formatDateTime(b.startTime, tz)}
                      <StatusBadge status={b.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          {showTicket ? <Ticket code={booking.bookingCode!} /> : null}

          <section className={card}>
            <h2 className="text-sm font-semibold text-slate-900">{t("detail.timeline")}</h2>
            <ol className="mt-4">
              {booking.timeline.map((entry, i) => {
                const Icon = TIMELINE_ICONS[entry.label] ?? Circle;
                const last = i === booking.timeline.length - 1;
                return (
                  <li key={`${entry.label}-${entry.at}`} className="relative flex gap-3 pb-5 last:pb-0">
                    {!last ? <span aria-hidden="true" className="absolute left-4 top-8 h-[calc(100%-2rem)] w-px bg-slate-200" /> : null}
                    <span
                      className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        last ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-600"
                      }`}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4" />
                    </span>
                    <div className="pt-1">
                      <p className="text-sm font-semibold text-slate-900">{translateOr(`timeline.${entry.label}`, entry.label)}</p>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(entry.at, tz)} · {timeAgo(entry.at)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

export default BookingDetail;
