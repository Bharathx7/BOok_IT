import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import PageHeader from "../../components/ui/PageHeader";
import BackLink from "../../components/ui/BackLink";
import VenueTabs from "../../components/venue/VenueTabs";
import { getVenueById, updateVenue, type VenueDetails } from "../../services/venue.api";
import {
  createBlackout,
  createTemplate,
  deleteBlackout,
  deleteTemplate,
  generateSlots,
  listBlackouts,
  listTemplates,
  updateTemplate,
  type Blackout,
  type GenerationResult,
  type SlotTemplate,
} from "../../services/tools.api";
import { formatDateTime, zonedTimeToUtc } from "../../lib/datetime";
import { alertError, alertSuccess, btnDanger, btnPrimary, btnSecondary, card, input, label, inputWidth } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";
import { currentLocale, translate } from "../../i18n/translate";
import Trans from "../../i18n/Trans";
import { weekdayShort } from "../../lib/venueOptions";

// Index = JS weekday (0 = Sunday).
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const STEP_OPTIONS = [15, 30, 45, 60, 90, 120];
const MAX_OPTIONS = [60, 90, 120, 180, 240, 360, 480, 720];

const minutesLabel = (minutes: number) =>
  minutes === 60
    ? translate("vd.hour")
    : minutes % 60 === 0
      ? translate("vd.hours", { count: minutes / 60 })
      : translate("vd.minutesLong", { count: minutes });

const daysSummary = (days: number[]) => {
  const sorted = [...days].sort();
  if (sorted.length === 7) return translate("sched.everyDay");
  if (sorted.join() === "1,2,3,4,5") return translate("sched.weekdays");
  if (sorted.join() === "0,6") return translate("sched.weekends");
  return sorted.map(weekdayShort).join(", ");
};

function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {WEEKDAYS.map((day) => {
        const active = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? value.filter((d) => d !== day) : [...value, day])}
            className={`h-9 w-11 rounded-xl text-sm font-medium ring-1 ${
              active ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200"
            }`}
          >
            {weekdayShort(day)}
          </button>
        );
      })}
    </div>
  );
}

function BookingSettings({ venue, onSaved }: { venue: VenueDetails; onSaved: (venue: VenueDetails) => void }) {
  const { t } = useI18n();
  const [slotMinutes, setSlotMinutes] = useState(venue.slotMinutes);
  const [maxMinutes, setMaxMinutes] = useState(venue.maxBookingMinutes);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const maxChoices = MAX_OPTIONS.filter((value) => value >= slotMinutes && value % slotMinutes === 0);

  async function save() {
    setStatus(null);
    try {
      const max = maxChoices.includes(maxMinutes) ? maxMinutes : maxChoices[0]!;
      await updateVenue(venue.id, { slotMinutes, maxBookingMinutes: max });
      setMaxMinutes(max);
      onSaved({ ...venue, slotMinutes, maxBookingMinutes: max });
      setStatus({ tone: "success", text: t("sched.settingsSaved") });
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className={card}>
      <h2 className="text-lg font-semibold text-slate-900">{t("sched.length")}</h2>
      <p className="mt-1 text-sm text-slate-500">
        {t("sched.lengthHint")}
      </p>
      {status ? <div className={`mt-4 ${status.tone === "success" ? alertSuccess : alertError}`}>{status.text}</div> : null}
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="step" className={label}>{t("sched.step")}</label>
          <select id="step" value={slotMinutes} onChange={(e) => setSlotMinutes(Number(e.target.value))} className={input}>
            {STEP_OPTIONS.map((value) => (
              <option key={value} value={value}>{minutesLabel(value)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="max" className={label}>{t("sched.max")}</label>
          <select id="max" value={maxChoices.includes(maxMinutes) ? maxMinutes : maxChoices[0]} onChange={(e) => setMaxMinutes(Number(e.target.value))} className={input}>
            {maxChoices.map((value) => (
              <option key={value} value={value}>{minutesLabel(value)}</option>
            ))}
          </select>
        </div>
        <button type="button" onClick={save} className={btnPrimary}>{t("common.save")}</button>
      </div>
    </section>
  );
}

const EMPTY_TEMPLATE = { name: "", daysOfWeek: [1, 2, 3, 4, 5, 6, 0], startTime: "06:00", endTime: "23:00", validFrom: "", validTo: "" };

function Templates({ venue }: { venue: VenueDetails }) {
  const { t } = useI18n();
  const [templates, setTemplates] = useState<SlotTemplate[] | null>(null);
  const [form, setForm] = useState(EMPTY_TEMPLATE);
  const [days, setDays] = useState(30);
  const [preview, setPreview] = useState<GenerationResult | null>(null);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => listTemplates(venue.id).then(setTemplates), [venue.id]);

  useEffect(() => {
    let cancelled = false;
    listTemplates(venue.id)
      .then((data) => {
        if (!cancelled) setTemplates(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus({ tone: "error", text: getErrorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [venue.id]);

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setStatus(null);
    try {
      await action();
      if (success) setStatus({ tone: "success", text: success });
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await createTemplate(venue.id, {
        name: form.name.trim() || null,
        daysOfWeek: form.daysOfWeek,
        startTime: form.startTime,
        endTime: form.endTime === "00:00" ? "24:00" : form.endTime,
        validFrom: form.validFrom || null,
        validTo: form.validTo || null,
        isActive: true,
      });
      setForm(EMPTY_TEMPLATE);
      setPreview(null);
      await load();
    }, t("sched.templateAdded"));
  }

  return (
    <section className={card}>
      <h2 className="text-lg font-semibold text-slate-900">{t("sched.templates")}</h2>
      <p className="mt-1 text-sm text-slate-500">
        {t("sched.templatesHint")}
      </p>

      {status ? <div className={`mt-4 ${status.tone === "success" ? alertSuccess : alertError}`}>{status.text}</div> : null}

      {templates === null ? (
        <p className="mt-4 text-sm text-slate-500">{t("common.loading")}</p>
      ) : templates.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">{t("sched.noTemplates")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100">
          {templates.map((template) => (
            <li key={template.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-medium text-slate-900">
                  {template.name || daysSummary(template.daysOfWeek)} · {template.startTime}–{template.endTime}
                  {!template.isActive ? <span className="ml-2 text-xs text-slate-400">{t("sched.paused")}</span> : null}
                </p>
                <p className="text-xs text-slate-500">
                  {daysSummary(template.daysOfWeek)}
                  {template.validFrom || template.validTo
                    ? ` · ${t("sched.validRange", { from: template.validFrom?.slice(0, 10) ?? "…", to: template.validTo?.slice(0, 10) ?? "…" })}`
                    : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(async () => { await updateTemplate(venue.id, template.id, { isActive: !template.isActive }); await load(); })}
                  className={btnSecondary}
                >
                  {template.isActive ? t("sched.pause") : t("sched.resume")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const removeFuture = window.confirm(
                      t("sched.confirmDelete")
                    );
                    void run(async () => {
                      const result = await deleteTemplate(venue.id, template.id, removeFuture);
                      await load();
                      setStatus({
                        tone: "success",
                        text: removeFuture
                          ? t("sched.templateDeletedSlots", { count: result.removedSlots })
                          : t("sched.templateDeleted"),
                      });
                    });
                  }}
                  className={btnDanger}
                >
                  {t("common.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="mt-5 space-y-4 rounded-xl bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-900">{t("sched.addTitle")}</p>
        <WeekdayPicker value={form.daysOfWeek} onChange={(daysOfWeek) => setForm({ ...form, daysOfWeek })} />
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className={label} htmlFor="t-open">{t("sched.opens")}</label>
            <input id="t-open" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className={input} required />
          </div>
          <div>
            <label className={label} htmlFor="t-close">{t("sched.closes")}</label>
            <input id="t-close" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className={input} required />
          </div>
          <div>
            <label className={label} htmlFor="t-from">{t("common.from")} <span className="font-normal text-slate-400">({t("common.optional")})</span></label>
            <input id="t-from" type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} className={input} />
          </div>
          <div>
            <label className={label} htmlFor="t-to">{t("sched.until")} <span className="font-normal text-slate-400">({t("common.optional")})</span></label>
            <input id="t-to" type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} className={input} />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label className={label} htmlFor="t-name">{t("common.name")} <span className="font-normal text-slate-400">({t("common.optional")})</span></label>
            <input id="t-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} placeholder={t("sched.namePlaceholder")} />
          </div>
          <button type="submit" disabled={busy || form.daysOfWeek.length === 0} className={btnPrimary}>{t("sched.add")}</button>
        </div>
        <p className="text-xs text-slate-500">{t("sched.midnight")}</p>
      </form>

      {templates && templates.some((template) => template.isActive) ? (
        <div className="mt-5 rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-900">{t("sched.createTitle")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <select value={days} onChange={(e) => { setDays(Number(e.target.value)); setPreview(null); }} className={`${inputWidth("w-auto")}`} aria-label={t("sched.ahead")}>
              {[7, 14, 30, 60, 90].map((value) => (
                <option key={value} value={value}>{t("sched.nextDays", { count: value })}</option>
              ))}
            </select>
            <button type="button" disabled={busy} onClick={() => run(async () => setPreview(await generateSlots(venue.id, { days, dryRun: true })))} className={btnSecondary}>
              {t("sched.preview")}
            </button>
            {preview && preview.planned.length > 0 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await generateSlots(venue.id, { days });
                    setPreview(null);
                    setStatus({
                      tone: "success",
                      text: [
                        result.created === 1 ? t("sched.createdOne") : t("sched.created", { count: result.created }),
                        result.skipped.length ? t("sched.skippedDays", { count: result.skipped.length }) : "",
                      ]
                        .filter(Boolean)
                        .join(" "),
                    });
                  })
                }
                className={btnPrimary}
              >
                {preview.planned.length === 1 ? t("sched.createOne") : t("sched.create", { count: preview.planned.length })}
              </button>
            ) : null}
          </div>

          {preview ? (
            <div className="mt-3 text-sm">
              {preview.planned.length === 0 ? (
                <p className="text-slate-500">{t("sched.nothing")}</p>
              ) : (
                <ul className="max-h-48 overflow-y-auto rounded-xl bg-slate-50 p-3 text-slate-700">
                  {preview.planned.map((slot) => (
                    <li key={`${slot.date}-${slot.startTime}`}>{new Date(`${slot.date}T12:00:00Z`).toLocaleDateString(currentLocale(), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} · {slot.startTime}–{slot.endTime}</li>
                  ))}
                </ul>
              )}
              {preview.skipped.length > 0 ? (
                <p className="mt-2 text-xs text-slate-500">{t("sched.willSkip", { count: preview.skipped.length })}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Blackouts({ venue }: { venue: VenueDetails }) {
  const { t } = useI18n();
  const [blackouts, setBlackouts] = useState<Blackout[] | null>(null);
  const [form, setForm] = useState({ from: "", fromTime: "00:00", to: "", toTime: "23:59", reason: "" });
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listBlackouts(venue.id)
      .then((data) => {
        if (!cancelled) setBlackouts(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [venue.id]);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setStatus(null);
    try {
      const start = zonedTimeToUtc(form.from, form.fromTime, venue.timezone);
      const end = zonedTimeToUtc(form.to || form.from, form.toTime, venue.timezone);
      const result = await createBlackout(venue.id, {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        reason: form.reason.trim() || null,
      });
      setBlackouts(await listBlackouts(venue.id));
      setForm({ from: "", fromTime: "00:00", to: "", toTime: "23:59", reason: "" });
      setStatus({
        tone: "success",
        text: result.affectedBookings
          ? t("sched.closureAffected", { count: result.affectedBookings })
          : t("sched.closureAdded"),
      });
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className={card}>
      <h2 className="text-lg font-semibold text-slate-900">{t("sched.closures")}</h2>
      <p className="mt-1 text-sm text-slate-500">{t("sched.closuresHint")}</p>
      {status ? <div className={`mt-4 ${status.tone === "success" ? alertSuccess : alertError}`}>{status.text}</div> : null}

      {blackouts && blackouts.length > 0 ? (
        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100 text-sm">
          {blackouts.map((blackout) => (
            <li key={blackout.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="font-medium text-slate-900">
                  {formatDateTime(blackout.startTime, venue.timezone)} – {formatDateTime(blackout.endTime, venue.timezone)}
                </span>
                {blackout.reason ? <span className="block text-slate-500">{blackout.reason}</span> : null}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await deleteBlackout(venue.id, blackout.id);
                  setBlackouts((current) => current?.filter((b) => b.id !== blackout.id) ?? null);
                }}
                className={btnSecondary}
              >
                {t("common.remove")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-slate-500">{t("sched.noClosures")}</p>
      )}

      <form onSubmit={handleAdd} className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className={label} htmlFor="b-from">{t("common.from")}</label>
          <input id="b-from" type="date" required value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="b-from-time">{t("sched.at")}</label>
          <input id="b-from-time" type="time" value={form.fromTime} onChange={(e) => setForm({ ...form, fromTime: e.target.value })} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="b-to">{t("common.to")}</label>
          <input id="b-to" type="date" value={form.to} min={form.from} onChange={(e) => setForm({ ...form, to: e.target.value })} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="b-to-time">{t("sched.at")}</label>
          <input id="b-to-time" type="time" value={form.toTime} onChange={(e) => setForm({ ...form, toTime: e.target.value })} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="b-reason">{t("common.reason")}</label>
          <input id="b-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={input} placeholder={t("sched.reasonPlaceholder")} />
        </div>
        <div className="sm:col-span-2 lg:col-span-5">
          <button type="submit" className={btnPrimary}>{t("sched.addClosure")}</button>
        </div>
      </form>
    </section>
  );
}

function VenueSchedule() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [venue, setVenue] = useState<VenueDetails | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getVenueById(id)
      .then((data) => {
        if (!cancelled) setVenue(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, translate("editor.loadFailed")));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div>
      <BackLink to="/provider/venues">{t("editor.back")}</BackLink>
      <PageHeader title={venue ? t("sched.title", { name: venue.name }) : t("vtabs.schedule")} description={t("sched.subtitle")} />
      {id ? <VenueTabs venueId={id} /> : null}
      {error ? <div className={alertError}>{error}</div> : null}
      {venue ? (
        <div className="space-y-6">
          <BookingSettings venue={venue} onSaved={setVenue} />
          <Templates venue={venue} />
          <Blackouts venue={venue} />
          <p className="text-sm text-slate-500">
            <Trans
              k="sched.oneOff"
              values={{
                slots: <Link to="/provider/time-slots" className="font-semibold text-brand-700 hover:underline">{t("nav.timeSlots")}</Link>,
                calendar: <Link to="/provider/calendar" className="font-semibold text-brand-700 hover:underline">{t("nav.calendar")}</Link>,
              }}
            />
          </p>
        </div>
      ) : !error ? (
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      ) : null}
    </div>
  );
}

export default VenueSchedule;
