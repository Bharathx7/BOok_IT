import { useEffect, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import PageHeader from "../../components/ui/PageHeader";
import { cancelBooking, confirmBooking } from "../../services/booking.api";
import { getMyVenues, type Venue } from "../../services/venue.api";
import {
  createManualBooking,
  getProviderCalendar,
  type CalendarBooking,
  type CalendarData,
} from "../../services/tools.api";
import { fetchAllPages } from "../../lib/pagination";
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import SegmentedControl from "../../components/ui/SegmentedControl";
import {
  dateKeyInTimeZone,
  dateParts,
  formatDateTime,
  formatTime,
  timeZoneLabel,
  todayKeyInTimeZone,
  zonedTimeToUtc,
} from "../../lib/datetime";
import { alertError, btnDanger, btnPrimary, btnSecondary, card, input, label, inputWidth } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";
import type { MessageKey } from "../../i18n/en";
import { currentLocale, translate, translateOr } from "../../i18n/translate";

const HOUR_PX = 48;
const CELL_MINUTES = 30;
const MINUTE = 60_000;

const addDays = (key: string, days: number) =>
  new Date(Date.parse(`${key}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Monday of the week containing `key`. */
const weekStart = (key: string) => {
  const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
  return addDays(key, -((weekday + 6) % 7));
};

const dayHeading = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString(currentLocale(), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// Each kind of block: a tinted fill and a strong left edge. The dark theme's
// global rules (index.css) turn the tints translucent and lighten the text;
// violet-50 has no such rule, so it gets its own dark fill here.
const TONES = {
  block: "bg-slate-100 border-slate-400 text-slate-700 [background-image:repeating-linear-gradient(135deg,transparent,transparent_6px,rgba(100,116,139,.14)_6px,rgba(100,116,139,.14)_12px)]",
  walkIn: "bg-violet-50 border-violet-500 text-violet-900 dark:bg-violet-500/15",
  pending: "bg-amber-50 border-amber-500 text-amber-900",
  completed: "bg-sky-50 border-sky-500 text-sky-900",
  confirmed: "bg-brand-50 border-brand-500 text-brand-900",
} as const;

const blockStyle = (booking: CalendarBooking) => {
  if (booking.source === "BLOCK") return TONES.block;
  if (booking.source === "WALK_IN") return TONES.walkIn;
  if (booking.status === "PENDING") return TONES.pending;
  if (booking.status === "COMPLETED") return TONES.completed;
  return TONES.confirmed;
};

const LEGEND: { label: MessageKey; className: string }[] = [
  { label: "status.PENDING", className: TONES.pending },
  { label: "status.CONFIRMED", className: TONES.confirmed },
  { label: "status.COMPLETED", className: TONES.completed },
  { label: "source.WALK_IN", className: TONES.walkIn },
  { label: "source.BLOCK", className: TONES.block },
  { label: "vd.closed", className: "bg-rose-50 border-rose-400" },
];

/** Re-renders every minute, for the "now" line. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

interface Selection {
  day: string;
  startMinute: number;
  endMinute: number;
}

function NewBookingDialog({
  venue,
  selection,
  onClose,
  onCreated,
}: {
  venue: CalendarData["venue"];
  selection: Selection;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<"BLOCK" | "WALK_IN">("BLOCK");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [note, setNote] = useState("");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const start = zonedTimeToUtc(selection.day, hhmm(selection.startMinute), venue.timezone);
  const end =
    selection.endMinute >= 1440
      ? zonedTimeToUtc(addDays(selection.day, 1), "00:00", venue.timezone)
      : zonedTimeToUtc(selection.day, hhmm(selection.endMinute), venue.timezone);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await createManualBooking({
        venueId: venue.id,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        kind,
        ...(kind === "WALK_IN" && { guestName: guestName.trim(), guestPhone: guestPhone.trim() || undefined }),
        ...(note.trim() && { note: note.trim() }),
        ...(kind === "WALK_IN" && price !== "" && { price: Number(price) }),
      });
      onCreated();
    } catch (err) {
      setError(getErrorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} className={`${card} w-full max-w-md space-y-4`}>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{dayHeading(selection.day)}</h2>
          <p className="text-sm text-slate-500">
            {formatTime(start, venue.timezone)} – {formatTime(end, venue.timezone)} {timeZoneLabel(venue.timezone, start)}
          </p>
        </div>

        <div className="flex gap-2">
          {(["BLOCK", "WALK_IN"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}
              className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium ring-1 ${kind === value ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200"}`}>
              {value === "BLOCK" ? t("cal.block") : t("cal.walkIn")}
            </button>
          ))}
        </div>

        {kind === "WALK_IN" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="g-name">{t("cal.customerName")}</label>
              <input id="g-name" required value={guestName} onChange={(e) => setGuestName(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label} htmlFor="g-phone">{t("common.phone")}</label>
              <input id="g-phone" type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} className={input} />
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="g-price">{t("cal.price")} <span className="font-normal text-slate-400">{t("cal.priceHint")}</span></label>
              <input id="g-price" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className={input} />
            </div>
          </div>
        ) : null}

        <div>
          <label className={label} htmlFor="g-note">{t("common.note")}</label>
          <input id="g-note" value={note} onChange={(e) => setNote(e.target.value)} className={input} placeholder={kind === "BLOCK" ? t("cal.notePlaceholder") : t("cal.optional")} />
        </div>

        {error ? <div className={alertError}>{error}</div> : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>{t("common.cancel")}</button>
          <button type="submit" disabled={saving} className={btnPrimary}>{saving ? t("common.saving") : t("common.save")}</button>
        </div>
      </form>
    </div>
  );
}

function BookingDetails({
  booking,
  timeZone,
  onClose,
  onChanged,
}: {
  booking: CalendarBooking;
  timeZone: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  }

  const title = booking.source === "BLOCK" ? t("pbook.blocked") : booking.customer?.name ?? t("detail.title");

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={`${card} w-full max-w-md space-y-3`}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <span className={`rounded-full border-l-4 px-2.5 py-1 text-xs font-semibold ${blockStyle(booking)}`}>
            {booking.source === "ONLINE" ? translateOr(`status.${booking.status}`, booking.status) : t(`source.${booking.source}`)}
          </span>
        </div>
        <p className="text-sm text-slate-600">
          {formatDateTime(booking.startTime, timeZone)} – {formatTime(booking.endTime, timeZone)}
        </p>
        {booking.customer ? (
          <p className="text-sm text-slate-600">
            {[booking.customer.email, booking.customer.phone].filter(Boolean).join(" · ") || t("cal.noContact")}
          </p>
        ) : null}
        {booking.totalPrice !== null && booking.source !== "BLOCK" ? (
          <p className="text-sm font-medium text-slate-900">₹{Number(booking.totalPrice).toFixed(2)}</p>
        ) : null}
        {booking.note ? <p className="text-sm text-slate-500">{t("cal.note", { note: booking.note })}</p> : null}
        {booking.status === "PENDING" && booking.expiresAt ? (
          <p className="text-sm text-amber-700">{t("pbook.confirmBy", { time: formatDateTime(booking.expiresAt, timeZone) })}</p>
        ) : null}

        {error ? <div className={alertError}>{error}</div> : null}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={btnSecondary}>{t("common.close")}</button>
          {booking.status === "PENDING" ? (
            <button type="button" disabled={busy} onClick={() => act(() => confirmBooking(booking.id))} className={btnPrimary}>
              {t("common.confirm")}
            </button>
          ) : null}
          {booking.status !== "COMPLETED" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(booking.source === "BLOCK" ? t("cal.confirmRemoveBlock") : t("cal.confirmCancel"))) {
                  void act(() => cancelBooking(booking.id));
                }
              }}
              className={btnDanger}
            >
              {booking.source === "BLOCK" ? t("cal.removeBlock") : t("mybook.cancel")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ProviderCalendar() {
  const { t } = useI18n();
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [venueId, setVenueId] = useState("");
  const [view, setView] = useState<"week" | "day">("week");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<{ key: string; calendar: CalendarData | null; error: string }>({ key: "", calendar: null, error: "" });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState<Selection | null>(null);
  const [openBooking, setOpenBooking] = useState<CalendarBooking | null>(null);
  const [loadError, setLoadError] = useState("");
  const dragStart = useRef<{ day: string; minute: number } | null>(null);
  const now = useNow();

  useEffect(() => {
    let cancelled = false;
    fetchAllPages(getMyVenues)
      .then((list) => {
        if (cancelled) return;
        setVenues(list);
        if (list[0]) setVenueId(list[0].id);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(err, translate("pvenues.loadFailed")));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const venue = venues?.find((v) => v.id === venueId) ?? null;
  const timeZone = venue?.timezone ?? "Asia/Kolkata";
  const current = anchor ?? todayKeyInTimeZone(timeZone);
  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(current), i)) : [current];
  const from = days[0]!;
  const to = days.at(-1)!;
  const key = `${venueId}:${from}:${to}:${reload}`;
  const loading = data.key !== key;

  useEffect(() => {
    if (!venueId) return;
    let cancelled = false;
    getProviderCalendar({ venueId, from, to })
      .then((calendar) => {
        if (!cancelled) setData({ key, calendar, error: "" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setData({ key, calendar: null, error: getErrorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [venueId, from, to, key]);

  const calendar = data.calendar;

  /** Minutes since local midnight for an instant, clipped to a given day. */
  const minutesOn = (value: string, day: string) => {
    const t = Date.parse(value);
    const dayStart = zonedTimeToUtc(day, "00:00", timeZone).getTime();
    return Math.min(Math.max((t - dayStart) / MINUTE, 0), 1440);
  };

  // Show hours from the earliest opening to the latest closing (at least 06–22).
  let firstHour = 6;
  let lastHour = 22;
  for (const item of [...(calendar?.slots ?? []), ...(calendar?.bookings ?? [])]) {
    const day = dateKeyInTimeZone(item.startTime, timeZone);
    firstHour = Math.min(firstHour, Math.floor(minutesOn(item.startTime, day) / 60));
    lastHour = Math.min(Math.max(lastHour, Math.ceil(minutesOn(item.endTime, day) / 60) || 24), 24);
  }

  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  const top = (minute: number) => ((minute - firstHour * 60) / 60) * HOUR_PX;

  const minuteFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = firstHour * 60 + ((event.clientY - rect.top) / HOUR_PX) * 60;
    return Math.min(Math.max(Math.floor(minute / CELL_MINUTES) * CELL_MINUTES, firstHour * 60), lastHour * 60 - CELL_MINUTES);
  };

  function onPointerDown(day: string, event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-booking]")) return;
    const minute = minuteFromPointer(event);
    dragStart.current = { day, minute };
    setDragging({ day, startMinute: minute, endMinute: minute + CELL_MINUTES });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(day: string, event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current || dragStart.current.day !== day) return;
    const minute = minuteFromPointer(event);
    const from = Math.min(dragStart.current.minute, minute);
    const to = Math.max(dragStart.current.minute, minute) + CELL_MINUTES;
    setDragging({ day, startMinute: from, endMinute: to });
  }

  function onPointerUp() {
    if (dragging) setSelection(dragging);
    dragStart.current = null;
    setDragging(null);
  }

  const step = view === "week" ? 7 : 1;
  const today = todayKeyInTimeZone(timeZone);
  const nowMinute = minutesOn(new Date(now).toISOString(), today);
  const showNow = days.includes(today) && nowMinute >= firstHour * 60 && nowMinute <= lastHour * 60;

  return (
    <div>
      <PageHeader title={t("nav.calendar")} description={t("cal.subtitle")} />

      {loadError ? <div className={alertError}>{loadError}</div> : null}
      {venues && venues.length === 0 ? <div className={`${card} text-sm text-slate-500`}>{t("cal.noVenue")}</div> : null}

      {venue ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className={`${inputWidth("w-auto")} py-2`} aria-label={t("common.venue")}>
                {venues!.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
              <SegmentedControl
                label={t("cal.viewLabel")}
                value={view}
                onChange={setView}
                options={[
                  { value: "week", label: t("cal.view.week"), icon: CalendarRange },
                  { value: "day", label: t("cal.view.day"), icon: CalendarDays },
                ]}
              />
            </div>
            <div className="flex items-center gap-2">
              <h2 className="mr-1 text-base font-semibold text-slate-900">
                {dayHeading(days[0]!)}{days.length > 1 ? ` – ${dayHeading(days.at(-1)!)}` : ""}
                <span className="ml-2 text-xs font-medium text-slate-500">{timeZoneLabel(timeZone)}</span>
              </h2>
              <div className="flex rounded-lg border border-slate-200 bg-white shadow-card">
                <button type="button" onClick={() => setAnchor(addDays(current, -step))} className="flex h-10 w-10 items-center justify-center rounded-l-lg text-slate-600 transition hover:bg-slate-50 hover:text-slate-900" aria-label={t("pager.previous")}>
                  <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setAnchor(null)} className="border-x border-slate-200 px-3.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                  {t("common.today")}
                </button>
                <button type="button" onClick={() => setAnchor(addDays(current, step))} className="flex h-10 w-10 items-center justify-center rounded-r-lg text-slate-600 transition hover:bg-slate-50 hover:text-slate-900" aria-label={t("pager.next")}>
                  <ChevronRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-slate-600">
            {LEGEND.map((item) => (
              <span key={item.label} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-3.5 w-3.5 rounded border-l-[3px] ${item.className}`} /> {t(item.label)}
              </span>
            ))}
          </div>

          {data.error ? <div className={`mb-3 ${alertError}`}>{data.error}</div> : null}

          <div className={`overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-card transition-opacity ${loading ? "opacity-60" : ""}`}>
            <div className="grid min-w-[44rem]" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
              <div className="border-b border-slate-200 bg-white" />
              {days.map((day) => {
                const parts = dateParts(`${day}T12:00:00Z`, "UTC");
                const isToday = day === today;
                return (
                  <div key={day} className="flex flex-col items-center gap-0.5 border-b border-l border-slate-200 bg-white px-2 py-2">
                    <span className={`text-xs font-semibold uppercase tracking-wide ${isToday ? "text-brand-600" : "text-slate-500"}`}>{parts.weekday}</span>
                    <span
                      className={`flex h-8 min-w-8 items-center justify-center rounded-full px-1.5 text-base font-bold tabular ${
                        isToday ? "bg-brand-600 text-white shadow-brand" : "text-slate-900"
                      }`}
                    >
                      {parts.day}
                    </span>
                  </div>
                );
              })}

              <div className="relative" style={{ height: hours.length * HOUR_PX }}>
                {hours.map((hour) => (
                  <div key={hour} className="absolute right-2 -translate-y-2 text-xs text-slate-500 tabular" style={{ top: (hour - firstHour) * HOUR_PX }}>
                    {String(hour).padStart(2, "0")}:00
                  </div>
                ))}
              </div>

              {days.map((day) => {
                const slots = calendar?.slots.filter((s) => minutesOn(s.endTime, day) > 0 && minutesOn(s.startTime, day) < 1440) ?? [];
                const bookings = calendar?.bookings.filter((b) => minutesOn(b.endTime, day) > 0 && minutesOn(b.startTime, day) < 1440) ?? [];
                const closures = calendar?.blackouts.filter((b) => minutesOn(b.endTime, day) > 0 && minutesOn(b.startTime, day) < 1440) ?? [];

                return (
                  <div
                    key={day}
                    className={`relative touch-none select-none border-l border-slate-100 ${day === today ? "bg-brand-50" : "bg-slate-50"}`}
                    style={{ height: hours.length * HOUR_PX }}
                    onPointerDown={(e) => onPointerDown(day, e)}
                    onPointerMove={(e) => onPointerMove(day, e)}
                    onPointerUp={onPointerUp}
                  >
                    {slots.map((slot) => (
                      <div key={slot.id} className={`absolute inset-x-0 ${day === today ? "bg-brand-50/40" : "bg-white"}`} style={{ top: top(minutesOn(slot.startTime, day)), height: top(minutesOn(slot.endTime, day)) - top(minutesOn(slot.startTime, day)) }} />
                    ))}
                    {hours.map((hour) => (
                      <div key={hour} className="pointer-events-none absolute inset-x-0 border-t border-slate-100" style={{ top: (hour - firstHour) * HOUR_PX }} />
                    ))}
                    {closures.map((closure) => (
                      <div key={closure.id} className="pointer-events-none absolute inset-x-0 bg-rose-50/80 px-1 text-[11px] text-rose-700" style={{ top: top(minutesOn(closure.startTime, day)), height: top(minutesOn(closure.endTime, day)) - top(minutesOn(closure.startTime, day)) }}>
                        {t("vd.closed")}{closure.reason ? ` · ${closure.reason}` : ""}
                      </div>
                    ))}
                    {bookings.map((booking) => {
                      const from = minutesOn(booking.startTime, day);
                      const to = minutesOn(booking.endTime, day);
                      const height = Math.max(top(to) - top(from) - 2, 18);
                      return (
                        <button
                          key={booking.id}
                          type="button"
                          data-booking
                          onClick={() => setOpenBooking(booking)}
                          className={`absolute inset-x-1 overflow-hidden rounded-md border-l-[3px] px-2 py-1 text-left text-xs leading-snug shadow-card transition hover:z-10 hover:shadow-raised ${blockStyle(booking)}`}
                          style={{ top: top(from) + 1, height }}
                        >
                          <span className="block truncate font-semibold">
                            {booking.source === "BLOCK" ? booking.note ?? t("source.BLOCK") : booking.customer?.name}
                          </span>
                          {height >= 36 ? (
                            <span className="block truncate opacity-80 tabular">
                              {formatTime(booking.startTime, timeZone)} – {formatTime(booking.endTime, timeZone)}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                    {showNow && day === today ? (
                      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-10" style={{ top: top(nowMinute) }}>
                        <div className="relative h-0.5 bg-rose-500">
                          <span className="absolute -left-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-rose-500" />
                        </div>
                      </div>
                    ) : null}
                    {dragging && dragging.day === day ? (
                      <div className="pointer-events-none absolute inset-x-1 rounded-lg bg-brand-500/20 ring-2 ring-brand-500" style={{ top: top(dragging.startMinute), height: top(dragging.endMinute) - top(dragging.startMinute) }} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {selection && calendar ? (
            <NewBookingDialog
              venue={calendar.venue}
              selection={selection}
              onClose={() => setSelection(null)}
              onCreated={() => {
                setSelection(null);
                setReload((value) => value + 1);
              }}
            />
          ) : null}

          {openBooking ? (
            <BookingDetails
              booking={openBooking}
              timeZone={timeZone}
              onClose={() => setOpenBooking(null)}
              onChanged={() => {
                setOpenBooking(null);
                setReload((value) => value + 1);
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
