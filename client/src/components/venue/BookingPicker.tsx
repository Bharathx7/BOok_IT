import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/useAuth";
import { createBooking, previewCoupon, type CouponQuote } from "../../services/booking.api";
import { createSeries, joinWaitlist, previewSeries, type SeriesWeek } from "../../services/features.api";
import {
  getDaySchedule,
  getPriceQuote,
  type DaySchedule,
  type PriceQuote,
} from "../../services/tools.api";
import type { VenueDetails } from "../../services/venue.api";
import {
  dateKeyInTimeZone,
  formatTime,
  timeZoneLabel,
  todayKeyInTimeZone,
} from "../../lib/datetime";
import { alertError, alertSuccess, btnPrimary, card, inputWidth } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";
import { currentLocale, translate } from "../../i18n/translate";
import { CheckoutClosedError, payOrder } from "../../lib/checkout";
import { takesOnlinePayment, usePaymentConfig } from "../../hooks/usePaymentConfig";
import { Check, X } from "lucide-react";

const MINUTE = 60_000;
const DAYS_SHOWN = 14;

interface StartOption {
  start: number;
  /** Longest booking possible from this start, in minutes. */
  maxMinutes: number;
}

/** Free start times on the venue's booking grid, and how long each can run. */
function startOptions(schedule: DaySchedule, now: number, ignore?: TimeRange | null): StartOption[] {
  const step = schedule.slotMinutes * MINUTE;
  const busy = schedule.busy
    // When moving a booking, its own current time counts as free.
    .filter((b) => !ignore || Date.parse(b.startTime) !== Date.parse(ignore.startTime) || Date.parse(b.endTime) !== Date.parse(ignore.endTime))
    .map((b) => [Date.parse(b.startTime), Date.parse(b.endTime)] as const);
  const isFree = (from: number, to: number) => busy.every(([bs, be]) => be <= from || bs >= to);
  const options: StartOption[] = [];

  for (const window of schedule.windows) {
    const windowStart = Date.parse(window.startTime);
    const windowEnd = Date.parse(window.endTime);

    for (let start = windowStart; start + step <= windowEnd; start += step) {
      if (start <= now || !isFree(start, start + step)) continue;

      let minutes = schedule.slotMinutes;
      while (
        minutes + schedule.slotMinutes <= schedule.maxBookingMinutes &&
        start + (minutes + schedule.slotMinutes) * MINUTE <= windowEnd &&
        isFree(start, start + (minutes + schedule.slotMinutes) * MINUTE)
      ) {
        minutes += schedule.slotMinutes;
      }

      options.push({ start, maxMinutes: minutes });
    }
  }

  return options;
}

const durationLabel = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? translate("common.hours", { count: hours }) : "", rest ? translate("common.minutes", { count: rest }) : ""]
    .filter(Boolean)
    .join(" ");
};

const refundSummary = (venue: VenueDetails) => {
  const tiers = venue.cancellationPolicy;
  if (!tiers || tiers.length === 0) return translate("picker.freeCancel");
  return (
    [...tiers]
      .sort((a, b) => b.hoursBefore - a.hoursBefore)
      .map((tier) => translate("picker.tier", { percent: tier.refundPercent, hours: tier.hoursBefore }))
      .join(" · ") + ` · ${translate("picker.otherwise")}`
  );
};

interface TimeRange {
  startTime: string;
  endTime: string;
}

interface BookingPickerProps {
  venue: VenueDetails;
  /** Replaces "book": e.g. moving an existing booking. Returns a success message. */
  onChoose?: (startTime: string, endTime: string) => Promise<string>;
  actionLabel?: string;
  /** A busy period to treat as free (the booking being moved). */
  ignore?: TimeRange | null;
}

/** Pick a day, a free start time and a length; shows the price before booking. */
function BookingPicker({ venue, onChoose, actionLabel, ignore = null }: BookingPickerProps) {
  const { user } = useAuth();
  const { t } = useI18n();
  const timeZone = venue.timezone;
  const today = todayKeyInTimeZone(timeZone);

  const days = useMemo(() => {
    const base = Date.parse(`${today}T12:00:00Z`);
    return Array.from({ length: DAYS_SHOWN }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  }, [today]);

  const [date, setDate] = useState(today);
  const [reload, setReload] = useState(0);
  const [schedule, setSchedule] = useState<{ key: string; data: DaySchedule | null; error: string }>({
    key: "",
    data: null,
    error: "",
  });
  const [start, setStart] = useState<number | null>(null);
  const [minutes, setMinutes] = useState(venue.slotMinutes);
  const [quote, setQuote] = useState<{ key: string; data: PriceQuote | null }>({ key: "", data: null });
  const [booking, setBooking] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [repeatWeeks, setRepeatWeeks] = useState(0);
  const [seriesPreview, setSeriesPreview] = useState<{ key: string; weeks: SeriesWeek[] }>({ key: "", weeks: [] });
  const isCustomerBooking = !onChoose && user?.role === "USER";
  const paymentConfig = usePaymentConfig();
  // Pay-online venues: pay while booking, confirmed as soon as it's paid.
  const payNow = takesOnlinePayment(venue, paymentConfig);
  const [couponText, setCouponText] = useState("");
  /** The code the customer applied; re-checked whenever the time changes. */
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState<{ key: string; quote: CouponQuote | null; error: string }>({
    key: "",
    quote: null,
    error: "",
  });

  const scheduleKey = `${date}:${reload}`;
  const loadingSchedule = schedule.key !== scheduleKey;

  useEffect(() => {
    let cancelled = false;
    getDaySchedule(venue.id, date)
      .then((data) => {
        if (!cancelled) setSchedule({ key: scheduleKey, data, error: "" });
      })
      .catch((error: unknown) => {
        if (!cancelled) setSchedule({ key: scheduleKey, data: null, error: getErrorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [venue.id, date, scheduleKey]);

  const options = useMemo(
    // eslint-disable-next-line react-hooks/purity -- "now" is re-read whenever the schedule reloads
    () => (schedule.data ? startOptions(schedule.data, Date.now(), ignore) : []),
    [schedule.data, ignore]
  );
  const selected = options.find((option) => option.start === start) ?? null;
  const length = selected ? Math.min(minutes, selected.maxMinutes) : minutes;
  const end = selected ? selected.start + length * MINUTE : null;
  const quoteKey = selected && end ? `${selected.start}-${end}` : "";

  useEffect(() => {
    if (!selected || !end) return;
    let cancelled = false;
    getPriceQuote(venue.id, new Date(selected.start).toISOString(), new Date(end).toISOString())
      .then((data) => {
        if (!cancelled) setQuote({ key: `${selected.start}-${end}`, data });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [venue.id, selected, end]);

  const currentQuote = quote.key === quoteKey ? quote.data : null;

  // Coupons apply to single bookings, not weekly series.
  const couponKey = isCustomerBooking && couponCode && quoteKey && !repeatWeeks ? `${couponCode}:${quoteKey}` : "";
  useEffect(() => {
    if (!couponKey || !selected || !end) return;
    let cancelled = false;
    previewCoupon({
      code: couponCode,
      venueId: venue.id,
      startTime: new Date(selected.start).toISOString(),
      endTime: new Date(end).toISOString(),
    })
      .then((data) => {
        if (!cancelled) setCouponResult({ key: couponKey, quote: data, error: "" });
      })
      .catch((error: unknown) => {
        if (!cancelled) setCouponResult({ key: couponKey, quote: null, error: getErrorMessage(error, translate("picker.codeInvalid")) });
      });
    return () => {
      cancelled = true;
    };
  }, [couponKey, couponCode, venue.id, selected, end]);
  const coupon = couponKey && couponResult.key === couponKey ? couponResult : null;
  const discounted = coupon?.quote ?? null;
  const payable = discounted ? discounted.total : currentQuote?.total;

  const seriesKey = repeatWeeks && selected && end ? `${quoteKey}:${repeatWeeks}` : "";
  useEffect(() => {
    if (!seriesKey || !selected || !end) return;
    let cancelled = false;
    previewSeries({
      venueId: venue.id,
      startTime: new Date(selected.start).toISOString(),
      durationMinutes: (end - selected.start) / MINUTE,
      weeks: repeatWeeks,
    })
      .then((weeks) => {
        if (!cancelled) setSeriesPreview({ key: seriesKey, weeks });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [seriesKey, venue.id, selected, end, repeatWeeks]);
  const seriesWeeks = seriesPreview.key === seriesKey ? seriesPreview.weeks : null;
  const freeWeeks = seriesWeeks?.filter((week) => week.available).length ?? 0;

  // Taken times on this day that a customer can queue for.
  const taken = useMemo(
    () =>
      isCustomerBooking
        ? // eslint-disable-next-line react-hooks/purity -- "now" is re-read whenever the schedule reloads
          (schedule.data?.busy ?? []).filter((b) => b.kind === "booked" && Date.parse(b.startTime) > Date.now())
        : [],
    [schedule.data, isCustomerBooking]
  );

  async function handleWaitlist(range: TimeRange) {
    setMessage(null);
    try {
      const { position } = await joinWaitlist(venue.id, range.startTime, range.endTime);
      setMessage({
        tone: "success",
        text: t("picker.waitlisted", { position, time: `${formatTime(range.startTime, timeZone)}–${formatTime(range.endTime, timeZone)}` }),
      });
    } catch (error) {
      setMessage({ tone: "error", text: getErrorMessage(error, t("picker.waitlistFailed")) });
    }
  }

  function chooseDate(next: string) {
    setDate(next);
    setStart(null);
    setMessage(null);
  }

  async function handleBook() {
    if (!selected || !end) return;
    setBooking(true);
    setMessage(null);

    try {
      const startIso = new Date(selected.start).toISOString();
      const endIso = new Date(end).toISOString();

      if (onChoose) {
        setMessage({ tone: "success", text: await onChoose(startIso, endIso) });
      } else if (repeatWeeks) {
        const series = await createSeries({
          venueId: venue.id,
          startTime: startIso,
          durationMinutes: (end - selected.start) / MINUTE,
          weeks: repeatWeeks,
        });
        setMessage({
          tone: "success",
          text: series.skipped
            ? t("picker.seriesDoneSkipped", { count: series.booked, skipped: series.skipped })
            : t("picker.seriesDone", { count: series.booked }),
        });
        setRepeatWeeks(0);
      } else {
        const created = await createBooking({
          venueId: venue.id,
          startTime: startIso,
          endTime: endIso,
          ...(discounted && { couponCode: discounted.coupon.code }),
        });
        setCouponCode("");
        setCouponText("");
        const time = `${formatTime(selected.start, timeZone)}–${formatTime(end, timeZone)}`;

        if (created.payment) {
          try {
            const paid = await payOrder(created.payment);
            setMessage(
              paid.status === "CONFIRMED"
                ? { tone: "success", text: t("pay.paidConfirmed", { time }) }
                : { tone: "success", text: t("pay.pending") }
            );
          } catch (error) {
            const until = created.booking.expiresAt ? formatTime(created.booking.expiresAt, timeZone) : "";
            setMessage(
              error instanceof CheckoutClosedError
                ? { tone: "error", text: t("pay.notFinished", { time, until }) }
                : { tone: "error", text: getErrorMessage(error, t("pay.pending")) }
            );
          }
        } else {
          setMessage({
            tone: "success",
            text: t(created.booking.status === "CONFIRMED" ? "pay.confirmedFree" : "picker.requested", { time }),
          });
        }
      }
      setStart(null);
      setReload((value) => value + 1);
    } catch (error) {
      setMessage({ tone: "error", text: getErrorMessage(error, t("picker.bookFailed")) });
      setReload((value) => value + 1);
    } finally {
      setBooking(false);
    }
  }

  const dayLabel = (key: string) =>
    new Date(`${key}T12:00:00Z`).toLocaleDateString(currentLocale(), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">{t("picker.title")}</h2>
        <span className="text-xs text-slate-500">{t("picker.tz", { zone: timeZoneLabel(timeZone) })}</span>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
        {days.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => chooseDate(key)}
            aria-pressed={date === key}
            className={`shrink-0 rounded-xl px-3 py-2 text-sm font-medium ring-1 transition ${
              date === key ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-200 hover:ring-brand-300"
            }`}
          >
            {key === today ? t("common.today") : dayLabel(key)}
          </button>
        ))}
        <input
          type="date"
          min={today}
          value={date}
          onChange={(event) => event.target.value && chooseDate(event.target.value)}
          aria-label={t("picker.otherDate")}
          className={`${inputWidth("w-auto")} shrink-0`}
        />
      </div>

      {message ? (
        <div className={`mt-3 ${message.tone === "success" ? alertSuccess : alertError}`}>{message.text}</div>
      ) : null}

      <div className="mt-4">
        {loadingSchedule ? (
          <p className="text-sm text-slate-500">{t("picker.checking")}</p>
        ) : schedule.error ? (
          <p className={alertError}>{schedule.error}</p>
        ) : options.length === 0 ? (
          <p className="text-sm text-slate-500">
            {schedule.data?.busy.some((b) => b.kind === "closed")
              ? schedule.data.busy.find((b) => b.kind === "closed")?.reason
                ? t("picker.closedReason", { reason: schedule.data.busy.find((b) => b.kind === "closed")!.reason! })
                : t("picker.closed")
              : t("picker.noTimes")}
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm font-medium text-slate-700">{t("browse.startTime")}</p>
            <div className="flex flex-wrap gap-2">
              {options.map((option) => (
                <button
                  key={option.start}
                  type="button"
                  onClick={() => {
                    setStart(option.start);
                    setMessage(null);
                  }}
                  aria-pressed={start === option.start}
                  className={`rounded-xl px-3 py-1.5 text-sm font-medium ring-1 transition ${
                    start === option.start
                      ? "bg-brand-600 text-white ring-brand-600"
                      : "bg-white text-slate-700 ring-slate-200 hover:ring-brand-300"
                  }`}
                >
                  {formatTime(option.start, timeZone)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {taken.length > 0 ? (
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-medium text-slate-700">{t("picker.taken")}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {taken.map((range) => (
              <li key={range.startTime} className="flex items-center gap-2 rounded-xl bg-white px-3 py-1.5 ring-1 ring-slate-200">
                <span className="text-slate-600">
                  {formatTime(range.startTime, timeZone)}–{formatTime(range.endTime, timeZone)}
                </span>
                <button type="button" onClick={() => void handleWaitlist(range)} className="font-semibold text-brand-700 hover:underline">
                  {t("picker.joinWaitlist")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {selected && end ? (
        <div className="mt-5 space-y-4 border-t border-slate-100 pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="duration" className="text-sm font-medium text-slate-700">
              {t("picker.length")}
            </label>
            <select
              id="duration"
              value={length}
              onChange={(event) => setMinutes(Number(event.target.value))}
              className={`${inputWidth("w-auto")}`}
            >
              {Array.from({ length: selected.maxMinutes / venue.slotMinutes }, (_, i) => (i + 1) * venue.slotMinutes).map(
                (value) => (
                  <option key={value} value={value}>
                    {durationLabel(value)}
                  </option>
                )
              )}
            </select>
            <span className="text-sm text-slate-500">
              {formatTime(selected.start, timeZone)} – {formatTime(end, timeZone)},{" "}
              {dateKeyInTimeZone(selected.start, timeZone) === today ? t("common.today") : dayLabel(date)}
            </span>
          </div>

          <div className="rounded-xl bg-slate-50 p-4 text-sm">
            {currentQuote ? (
              <>
                {currentQuote.breakdown.map((line) => (
                  <div key={line.start} className="flex justify-between gap-3 text-slate-600">
                    <span>
                      {line.label} · {formatTime(line.start, timeZone)}–{formatTime(line.end, timeZone)}
                    </span>
                    <span>₹{line.amount.toFixed(2)}</span>
                  </div>
                ))}
                {discounted ? (
                  <div className="flex justify-between gap-3 text-brand-700">
                    <span>{t("picker.code", { code: discounted.coupon.code })}{discounted.coupon.description ? ` · ${discounted.coupon.description}` : ""}</span>
                    <span>−₹{discounted.discount.toFixed(2)}</span>
                  </div>
                ) : null}
                <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
                  <span>{t("common.total")}</span>
                  <span>₹{(payable ?? currentQuote.total).toFixed(2)}</span>
                </div>
              </>
            ) : (
              <span className="text-slate-500">{t("picker.pricing")}</span>
            )}
          </div>

          <p className="text-xs text-slate-500">
            {payNow && isCustomerBooking ? `${t("pay.instantNote")} ` : ""}
            {refundSummary(venue)}
          </p>

          {isCustomerBooking && !repeatWeeks ? (
            <form
              className="flex flex-wrap items-center gap-2 text-sm"
              onSubmit={(event) => {
                event.preventDefault();
                setCouponCode(couponText.trim().toUpperCase());
              }}
            >
              <label htmlFor="coupon" className="font-medium text-slate-700">{t("picker.coupon")}</label>
              <input
                id="coupon"
                value={couponText}
                onChange={(event) => setCouponText(event.target.value)}
                placeholder={t("picker.codePlaceholder")}
                maxLength={40}
                className={`${inputWidth("w-40")} uppercase`}
              />
              {couponCode ? (
                <button
                  type="button"
                  onClick={() => {
                    setCouponCode("");
                    setCouponText("");
                  }}
                  className="font-semibold text-slate-500 hover:underline"
                >
                  {t("common.remove")}
                </button>
              ) : (
                <button type="submit" disabled={!couponText.trim()} className="font-semibold text-brand-700 hover:underline disabled:opacity-50">
                  {t("common.apply")}
                </button>
              )}
              {couponKey && !coupon ? <span className="text-slate-400">{t("picker.checkingCode")}</span> : null}
              {coupon?.error ? <span className="text-rose-700">{coupon.error}</span> : null}
            </form>
          ) : null}

          {isCustomerBooking && !payNow ? (
            <div className="rounded-xl border border-slate-200 p-3 text-sm">
              <label className="flex items-center gap-2 font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={repeatWeeks > 0}
                  onChange={(event) => setRepeatWeeks(event.target.checked ? 4 : 0)}
                  className="h-4 w-4 accent-brand-600"
                />
                {t("picker.repeat")}
              </label>
              {repeatWeeks > 0 ? (
                <div className="mt-2 space-y-2">
                  <select value={repeatWeeks} onChange={(event) => setRepeatWeeks(Number(event.target.value))} className={`${inputWidth("w-auto")}`} aria-label={t("picker.weeks")}>
                    {Array.from({ length: 11 }, (_, i) => i + 2).map((weeks) => (
                      <option key={weeks} value={weeks}>{t("picker.forWeeks", { count: weeks })}</option>
                    ))}
                  </select>
                  {seriesWeeks ? (
                    <ul className="grid gap-1 sm:grid-cols-2">
                      {seriesWeeks.map((week) => (
                        <li key={week.startTime} className={`flex items-center gap-1.5 ${week.available ? "text-slate-700" : "text-slate-400 line-through"}`} title={week.reason ?? undefined}>
                          {week.available ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" /> : <X aria-hidden="true" className="h-3.5 w-3.5 text-rose-500" />} {new Date(week.startTime).toLocaleDateString(currentLocale(), { weekday: "short", day: "numeric", month: "short", timeZone })}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-slate-500">{t("picker.checkingWeeks")}</p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {onChoose ? (
            <button type="button" onClick={handleBook} disabled={booking || !currentQuote} className={`w-full ${btnPrimary}`}>
              {booking ? t("common.saving") : `${actionLabel ?? t("picker.choose")}${currentQuote ? ` · ₹${currentQuote.total.toFixed(2)}` : ""}`}
            </button>
          ) : user?.role === "USER" ? (
            <button type="button" onClick={handleBook} disabled={booking || !currentQuote || (repeatWeeks > 0 && freeWeeks === 0)} className={`w-full ${btnPrimary}`}>
              {booking
                ? t("picker.booking")
                : repeatWeeks > 0
                  ? freeWeeks === 1
                    ? t("picker.requestSeriesOne")
                    : t("picker.requestSeries", { count: freeWeeks })
                  : currentQuote
                    ? `${t(payNow ? "pay.bookAndPay" : "picker.request")} · ₹${(payable ?? currentQuote.total).toFixed(2)}`
                    : t(payNow ? "pay.bookAndPay" : "picker.request")}
            </button>
          ) : !user ? (
            <Link to="/login" className={`block w-full text-center ${btnPrimary}`}>
              {t("picker.signIn")}
            </Link>
          ) : (
            <p className="text-sm text-slate-500">{t("picker.onlyCustomers")}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default BookingPicker;
