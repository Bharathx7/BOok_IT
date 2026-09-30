import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Clock, Pencil, Trash2 } from "lucide-react";
import {
  getVenueTimeSlots,
  createTimeSlot,
  updateTimeSlot,
  deleteTimeSlot,
  type TimeSlot,
} from "../../services/timeslot.api";
import { getMyVenues, type Venue } from "../../services/venue.api";
import PageHeader from "../../components/ui/PageHeader";
import { getErrorMessage } from "../../lib/errors";
import { fetchAllPages } from "../../lib/pagination";
import {
  alertError,
  btnPrimary,
  btnSecondary,
  card,
  inputWidth,
  label,
} from "../../lib/ui";
import {
  buildTimeOptions,
  formatLongDate,
  getCalendarCells,
  isSameDay,
  parseDateKey,
  startOfToday,
  toDateKey,
} from "../../lib/calendar";
import {
  dateKeyInTimeZone,
  formatTime,
  timeInTimeZone,
  timeZoneLabel,
  todayKeyInTimeZone,
  zonedTimeToUtc,
} from "../../lib/datetime";
import { useI18n } from "../../i18n/useI18n";
import { translate, currentLocale } from "../../i18n/translate";
import { DURATIONS, weekdayShort } from "../../lib/venueOptions";

const TIME_OPTIONS = buildTimeOptions();

function ProviderTimeSlots() {
  const { t } = useI18n();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState("");
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);

  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => startOfToday());
  const [startTime, setStartTime] = useState("18:00");
  const timeList = useRef<HTMLDivElement>(null);

  // Keep the chosen start time visible inside the scrolling list (e.g. 18:00 on first load).
  useEffect(() => {
    const list = timeList.current;
    const chosen = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
    // Line rows up with the top edge (one row of context above), never half a row.
    const rowPitch = chosen ? chosen.offsetHeight + 8 : 0;
    if (list && chosen) list.scrollTop = Math.max(chosen.offsetTop - list.offsetTop - rowPitch, 0);
  }, [startTime, selectedVenueId]);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsReloadKey, setSlotsReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deletingSlotId, setDeletingSlotId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadVenues = async () => {
      try {
        const data = await fetchAllPages(getMyVenues);
        if (cancelled) return;
        setVenues(data);

        if (data.length > 0) {
          setLoadingSlots(true);
          setSelectedVenueId(data[0].id);
        }
      } catch (error) {
        if (!cancelled) setError(getErrorMessage(error, translate("pvenues.loadFailed")));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadVenues();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedVenueId) {
      return;
    }

    let cancelled = false;

    const loadTimeSlots = async () => {
      try {
        const data = await getVenueTimeSlots(selectedVenueId);
        if (!cancelled) setTimeSlots(data);
      } catch (error) {
        if (!cancelled) setError(getErrorMessage(error, translate("slots.loadFailed")));
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    };

    loadTimeSlots();

    return () => {
      cancelled = true;
    };
  }, [selectedVenueId, slotsReloadKey]);

  const reloadTimeSlots = () => setSlotsReloadKey((key) => key + 1);

  // Calendar days and the time picker are in the venue's timezone, whatever
  // timezone the provider's browser is in.
  const venueTimeZone = venues.find((venue) => venue.id === selectedVenueId)?.timezone;
  const todayKey = todayKeyInTimeZone(venueTimeZone);

  const calendarCells = useMemo(() => getCalendarCells(viewDate), [viewDate]);

  const slotsByDate = useMemo(() => {
    const grouped = new Map<string, TimeSlot[]>();

    for (const slot of timeSlots) {
      const key = dateKeyInTimeZone(slot.startTime, venueTimeZone);
      const current = grouped.get(key) ?? [];
      current.push(slot);
      grouped.set(key, current);
    }

    for (const slots of grouped.values()) {
      slots.sort(
        (left, right) =>
          new Date(left.startTime).getTime() - new Date(right.startTime).getTime()
      );
    }

    return grouped;
  }, [timeSlots, venueTimeZone]);

  const selectedDaySlots = slotsByDate.get(toDateKey(selectedDate)) ?? [];

  const selectedStart = zonedTimeToUtc(toDateKey(selectedDate), startTime, venueTimeZone);
  const selectedEnd = new Date(selectedStart.getTime() + durationMinutes * 60 * 1000);

  const overlapsExisting = selectedDaySlots.some((slot) => {
    if (slot.id === editingSlotId) {
      return false;
    }

    const slotStart = new Date(slot.startTime).getTime();
    const slotEnd = new Date(slot.endTime).getTime();

    return selectedStart.getTime() < slotEnd && selectedEnd.getTime() > slotStart;
  });

  const isPastDay = toDateKey(selectedDate) < todayKey;

  function resetForm() {
    setStartTime("18:00");
    setDurationMinutes(60);
    setEditingSlotId(null);
  }

  function changeMonth(offset: number) {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  function goToToday() {
    const today = parseDateKey(todayKey);
    setViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(today);
    resetForm();
  }

  async function handleSaveSlot() {
    if (!selectedVenueId) {
      setError(t("slots.selectVenue"));
      return;
    }

    if (isPastDay) {
      setError(t("slots.pastDate"));
      return;
    }

    if (selectedStart >= selectedEnd) {
      setError(t("slots.order"));
      return;
    }

    if (overlapsExisting) {
      setError(t("slots.overlap"));
      return;
    }

    try {
      setSaving(true);
      setError("");

      if (editingSlotId) {
        await updateTimeSlot(editingSlotId, {
          startTime: selectedStart.toISOString(),
          endTime: selectedEnd.toISOString(),
        });
      } else {
        await createTimeSlot({
          venueId: selectedVenueId,
          startTime: selectedStart.toISOString(),
          endTime: selectedEnd.toISOString(),
        });
      }

      resetForm();
      reloadTimeSlots();
    } catch (error) {
      setError(getErrorMessage(error, t("slots.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  function handleEditTimeSlot(slot: TimeSlot) {
    const start = new Date(slot.startTime);
    const end = new Date(slot.endTime);
    const minutes = Math.max(30, Math.round((end.getTime() - start.getTime()) / 60000));
    const matchedDuration =
      DURATIONS.find((option) => option.minutes === minutes)?.minutes ?? 60;

    const day = parseDateKey(dateKeyInTimeZone(start, venueTimeZone));

    setSelectedDate(day);
    setViewDate(new Date(day.getFullYear(), day.getMonth(), 1));
    setStartTime(timeInTimeZone(start, venueTimeZone));
    setDurationMinutes(matchedDuration);
    setEditingSlotId(slot.id);
    setError("");
  }

  async function handleDeleteTimeSlot(slotId: string) {
    const confirmed = window.confirm(t("slots.confirmDelete"));

    if (!confirmed) {
      return;
    }

    try {
      setDeletingSlotId(slotId);
      setError("");
      await deleteTimeSlot(slotId);

      if (editingSlotId === slotId) {
        resetForm();
      }

      reloadTimeSlots();
    } catch (error) {
      setError(getErrorMessage(error, t("slots.deleteFailed")));
    } finally {
      setDeletingSlotId(null);
    }
  }

  if (loading) {
    return (
      <div className={`${card} text-sm text-slate-500`}>{t("slots.loadingVenues")}</div>
    );
  }

  const monthLabel = viewDate.toLocaleDateString(currentLocale(), {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <PageHeader
        title={t("nav.timeSlots")}
        description={t("slots.subtitle")}
        action={
          venues.length > 0 ? (
            <select
              value={selectedVenueId}
              onChange={(event) => {
                setLoadingSlots(true);
                setError("");
                setSelectedVenueId(event.target.value);
                resetForm();
              }}
              aria-label={t("slots.selectVenueLabel")}
              className={`${inputWidth("w-auto")} min-w-56 py-2`}
            >
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />

      {error ? <div className={`mb-6 ${alertError}`}>{error}</div> : null}

      {venues.length === 0 ? (
        <div className={card}>
          <h2 className="text-lg font-semibold text-slate-900">{t("slots.noVenues")}</h2>
          <p className="mt-2 text-sm text-slate-500">
            {t("slots.noVenuesHint")}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <section className={card}>
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">
                    {t("nav.calendar")}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900">
                    {monthLabel}
                  </h2>
                </div>

                <div className="flex items-center gap-2">
                  <button type="button" onClick={goToToday} className={btnSecondary}>
                    {t("common.today")}
                  </button>
                  <button
                    type="button"
                    onClick={() => changeMonth(-1)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-card transition hover:bg-slate-50 hover:text-slate-900"
                    aria-label={t("slots.prevMonth")}
                  >
                    <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => changeMonth(1)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-card transition hover:bg-slate-50 hover:text-slate-900"
                    aria-label={t("slots.nextMonth")}
                  >
                    <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">
                {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                  <div key={day} className="py-2">
                    {weekdayShort(day)}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {calendarCells.map(({ date, inMonth }) => {
                  const key = toDateKey(date);
                  const slotCount = slotsByDate.get(key)?.length ?? 0;
                  const selected = isSameDay(date, selectedDate);
                  const today = key === todayKey;
                  const past = key < todayKey;

                  return (
                    <button
                      key={key + String(inMonth)}
                      type="button"
                      onClick={() => {
                        setSelectedDate(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
                        if (!inMonth) {
                          setViewDate(new Date(date.getFullYear(), date.getMonth(), 1));
                        }
                        setEditingSlotId(null);
                        setError("");
                      }}
                      className={`flex min-h-16 flex-col items-center rounded-xl px-1 py-2 text-sm transition ${
                        selected
                          ? "bg-brand-600 text-white shadow-sm"
                          : today
                            ? "bg-brand-50 text-brand-900 ring-1 ring-brand-200"
                            : inMonth
                              ? "text-slate-800 hover:bg-slate-50"
                              : "text-slate-300 hover:bg-slate-50"
                      } ${past && !selected ? "opacity-60" : ""}`}
                    >
                      <span className="font-semibold">{date.getDate()}</span>
                      {slotCount > 0 ? (
                        <span
                          className={`mt-2 h-1.5 w-1.5 rounded-full ${
                            selected ? "bg-white" : "bg-brand-500"
                          }`}
                        />
                      ) : (
                        <span className="mt-2 h-1.5 w-1.5" />
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className={card}>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">
                {editingSlotId ? t("slots.edit") : t("slots.create")}
              </p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">
                {formatLongDate(selectedDate)}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {selectedDaySlots.length === 0
                  ? t("slots.noneToday")
                  : selectedDaySlots.length === 1
                    ? t("slots.openOne")
                    : t("slots.openCount", { count: selectedDaySlots.length })}
              </p>

              <div className="mt-5">
                <label className={label}>
                  {t("slots.startTime", { zone: timeZoneLabel(venueTimeZone) })}
                </label>
                {/* Exactly four rows tall, so the edge of the list never cuts a row in half. */}
                <div ref={timeList} className="grid max-h-[10.5rem] grid-cols-4 gap-2 overflow-y-auto overscroll-contain pr-1">
                  {TIME_OPTIONS.map((time) => {
                    const active = startTime === time;
                    return (
                      <button
                        key={time}
                        type="button"
                        onClick={() => setStartTime(time)}
                        aria-pressed={active}
                        className={`h-9 rounded-lg px-2 text-sm font-medium tabular transition ${
                          active
                            ? "bg-brand-600 text-white"
                            : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {time}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-5">
                <label className={label}>{t("browse.duration")}</label>
                <div className="flex flex-wrap gap-2">
                  {DURATIONS.map((option) => (
                    <button
                      key={option.minutes}
                      type="button"
                      onClick={() => setDurationMinutes(option.minutes)}
                      aria-pressed={durationMinutes === option.minutes}
                      className={`rounded-full px-3.5 py-2 text-sm font-medium transition ${
                        durationMinutes === option.minutes
                          ? "bg-brand-600 text-white"
                          : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {t(option.label)}
                    </button>
                  ))}
                </div>
              </div>

              <div
                className={`mt-5 rounded-xl border px-4 py-3 text-sm ${
                  overlapsExisting ? "border-rose-200 bg-rose-50" : "border-brand-100 bg-brand-50"
                }`}
              >
                <p className="flex items-center gap-2 font-semibold text-slate-900">
                  <Clock aria-hidden="true" className="h-4 w-4 text-brand-600" />
                  {formatTime(selectedStart, venueTimeZone)} – {formatTime(selectedEnd, venueTimeZone)}{" "}
                  <span className="font-medium text-slate-500">{timeZoneLabel(venueTimeZone, selectedStart)}</span>
                </p>
                {overlapsExisting ? (
                  <p className="mt-1 flex items-center gap-2 font-medium text-rose-700">
                    <AlertCircle aria-hidden="true" className="h-4 w-4" />
                    {t("slots.overlapsHint")}
                  </p>
                ) : null}
              </div>

              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={handleSaveSlot}
                  disabled={saving || isPastDay || overlapsExisting}
                  className={`flex-1 ${btnPrimary}`}
                >
                  {saving
                    ? t("common.saving")
                    : editingSlotId
                      ? t("slots.update")
                      : t("slots.create")}
                </button>
                {editingSlotId ? (
                  <button type="button" onClick={resetForm} className={btnSecondary}>
                    {t("common.cancel")}
                  </button>
                ) : null}
              </div>

              {isPastDay ? (
                <p className="mt-3 text-sm text-slate-500">
                  {t("slots.pastHint")}
                </p>
              ) : null}

              <div className="mt-8 border-t border-slate-100 pt-5">
                <h3 className="mb-3 text-sm font-semibold text-slate-900">
                  {t("slots.thisDay")}
                </h3>

                {loadingSlots ? (
                  <p className="text-sm text-slate-500">{t("slots.loading")}</p>
                ) : selectedDaySlots.length === 0 ? (
                  <p className="text-sm text-slate-500">{t("slots.nothing")}</p>
                ) : (
                  <div className="space-y-3">
                    {selectedDaySlots.map((slot) => (
                      <div
                        key={slot.id}
                        className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                          editingSlotId === slot.id ? "border-brand-300 bg-brand-50" : "border-slate-200"
                        }`}
                      >
                        <div>
                          <p className="font-semibold text-slate-900 tabular">
                            {formatTime(slot.startTime, venueTimeZone)} –{" "}
                            {formatTime(slot.endTime, venueTimeZone)}
                          </p>
                          {editingSlotId === slot.id ? (
                            <p className="text-xs font-medium text-brand-700">{t("slots.editing")}</p>
                          ) : null}
                        </div>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => handleEditTimeSlot(slot)}
                            aria-label={t("common.edit")}
                            title={t("common.edit")}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                          >
                            <Pencil aria-hidden="true" className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTimeSlot(slot.id)}
                            disabled={deletingSlotId === slot.id}
                            aria-label={t("common.delete")}
                            title={t("common.delete")}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                          >
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProviderTimeSlots;
