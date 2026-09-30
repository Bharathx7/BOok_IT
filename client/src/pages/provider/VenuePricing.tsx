import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useParams } from "react-router-dom";
import PageHeader from "../../components/ui/PageHeader";
import BackLink from "../../components/ui/BackLink";
import VenueTabs from "../../components/venue/VenueTabs";
import {
  getVenueById,
  updateVenue,
  type CancellationTier,
  type VenueDetails,
} from "../../services/venue.api";
import {
  createPricingRule,
  deletePricingRule,
  getPriceQuote,
  listPricingRules,
  updatePricingRule,
  type PriceQuote,
  type PricingRule,
} from "../../services/tools.api";
import { formatTime, todayKeyInTimeZone, zonedTimeToUtc } from "../../lib/datetime";
import { alertError, alertSuccess, btnDanger, btnPrimary, btnSecondary, card, input, label, inputWidth } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";
import { translate } from "../../i18n/translate";
import { weekdayShort } from "../../lib/venueOptions";
import Trans from "../../i18n/Trans";
import type { MessageKey } from "../../i18n/en";

// Index = JS weekday (0 = Sunday).
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

const ruleSummary = (rule: PricingRule, base: number) => {
  const days =
    rule.daysOfWeek.length === 0 || rule.daysOfWeek.length === 7
      ? translate("sched.everyDay")
      : rule.daysOfWeek.map(weekdayShort).join(", ");
  const price =
    rule.type === "FIXED"
      ? translate("pricing.fixed", { amount: Number(rule.value) })
      : translate("pricing.multiplier", { value: Number(rule.value), amount: Math.round(base * Number(rule.value)) });
  const dates =
    rule.validFrom || rule.validTo
      ? ` · ${translate("sched.validRange", { from: rule.validFrom?.slice(0, 10) ?? "…", to: rule.validTo?.slice(0, 10) ?? "…" })}`
      : "";
  return `${days} · ${rule.startTime}–${rule.endTime} · ${price}${dates}`;
};

const EMPTY_RULE = {
  name: "",
  daysOfWeek: [] as number[],
  startTime: "18:00",
  endTime: "22:00",
  type: "MULTIPLIER" as "FIXED" | "MULTIPLIER",
  value: "1.25",
  priority: "0",
  validFrom: "",
  validTo: "",
};

function PricingRules({ venue }: { venue: VenueDetails }) {
  const { t } = useI18n();
  const base = Number(venue.pricePerHour);
  const [rules, setRules] = useState<PricingRule[] | null>(null);
  const [form, setForm] = useState(EMPTY_RULE);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listPricingRules(venue.id)
      .then((data) => {
        if (!cancelled) setRules(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus({ tone: "error", text: getErrorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [venue.id, version]);

  const refresh = () => setVersion((value) => value + 1);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setStatus(null);
    try {
      await createPricingRule(venue.id, {
        name: form.name.trim(),
        daysOfWeek: form.daysOfWeek,
        startTime: form.startTime,
        endTime: form.endTime === "00:00" ? "24:00" : form.endTime,
        type: form.type,
        value: Number(form.value),
        priority: Number(form.priority),
        validFrom: form.validFrom || null,
        validTo: form.validTo || null,
        isActive: true,
      });
      setForm(EMPTY_RULE);
      refresh();
      setStatus({ tone: "success", text: t("pricing.added") });
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    }
  }

  return (
    <section className={card}>
      <h2 className="text-lg font-semibold text-slate-900">{t("pricing.rules")}</h2>
      <p className="mt-1 text-sm text-slate-500">
        <Trans k="pricing.rulesHint" values={{ base: <strong>{t("pricing.fixed", { amount: base })}</strong> }} />
      </p>
      {status ? <div className={`mt-4 ${status.tone === "success" ? alertSuccess : alertError}`}>{status.text}</div> : null}

      {rules && rules.length > 0 ? (
        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100">
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-medium text-slate-900">
                  {rule.name}
                  <span className="ml-2 text-xs font-normal text-slate-400">{t("pricing.priority", { value: rule.priority })}</span>
                  {!rule.isActive ? <span className="ml-2 text-xs text-slate-400">{t("pricing.off")}</span> : null}
                </p>
                <p className="text-xs text-slate-500">{ruleSummary(rule, base)}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={async () => { await updatePricingRule(venue.id, rule.id, { isActive: !rule.isActive }); refresh(); }} className={btnSecondary}>
                  {rule.isActive ? t("pricing.turnOff") : t("pricing.turnOn")}
                </button>
                <button type="button" onClick={async () => { if (window.confirm(t("pricing.confirmDelete", { name: rule.name }))) { await deletePricingRule(venue.id, rule.id); refresh(); } }} className={btnDanger}>
                  {t("common.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : rules ? (
        <p className="mt-4 text-sm text-slate-500">{t("pricing.none")}</p>
      ) : null}

      <form onSubmit={handleAdd} className="mt-5 space-y-4 rounded-xl bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-900">{t("pricing.addTitle")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="r-name">{t("common.name")}</label>
            <input id="r-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} placeholder={t("pricing.namePlaceholder")} />
          </div>
          <div>
            <p className={label}>{t("pricing.days")} <span className="font-normal text-slate-400">{t("pricing.daysHint")}</span></p>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((day) => {
                const active = form.daysOfWeek.includes(day);
                return (
                  <button key={day} type="button" aria-pressed={active}
                    onClick={() => setForm({ ...form, daysOfWeek: active ? form.daysOfWeek.filter((d) => d !== day) : [...form.daysOfWeek, day] })}
                    className={`h-9 w-11 rounded-xl text-sm font-medium ring-1 ${active ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200"}`}>
                    {weekdayShort(day)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <label className={label} htmlFor="r-from">{t("common.from")}</label>
            <input id="r-from" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className={input} />
          </div>
          <div>
            <label className={label} htmlFor="r-to">{t("common.to")}</label>
            <input id="r-to" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className={input} />
          </div>
          <div>
            <label className={label} htmlFor="r-type">{t("common.price")}</label>
            <select id="r-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "FIXED" | "MULTIPLIER", value: e.target.value === "FIXED" ? String(base) : "1.25" })} className={input}>
              <option value="MULTIPLIER">{t("pricing.typeMultiplier")}</option>
              <option value="FIXED">{t("pricing.typeFixed")}</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="r-value">{form.type === "FIXED" ? t("pricing.perHourShort") : t("pricing.multiplierLabel")}</label>
            <input id="r-value" type="number" min={0} step={form.type === "FIXED" ? 1 : 0.05} required value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className={input} />
          </div>
          <div>
            <label className={label} htmlFor="r-priority">{t("pricing.priorityLabel")}</label>
            <input id="r-priority" type="number" min={-100} max={100} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={input} />
          </div>
          <div className="flex items-end">
            <button type="submit" className={`w-full ${btnPrimary}`}>{t("pricing.add")}</button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="r-valid-from">{t("pricing.onlyFrom")} <span className="font-normal text-slate-400">{t("pricing.onlyFromHint")}</span></label>
            <input id="r-valid-from" type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} className={input} />
          </div>
          <div>
            <label className={label} htmlFor="r-valid-to">{t("sched.until")}</label>
            <input id="r-valid-to" type="date" value={form.validTo} min={form.validFrom} onChange={(e) => setForm({ ...form, validTo: e.target.value })} className={input} />
          </div>
        </div>
        <p className="text-xs text-slate-500">{t("pricing.overnight")}</p>
      </form>

      <PricePreview venue={venue} version={version} />
    </section>
  );
}

function PricePreview({ venue, version }: { venue: VenueDetails; version: number }) {
  const { t } = useI18n();
  const [date, setDate] = useState(() => todayKeyInTimeZone(venue.timezone));
  const [time, setTime] = useState("18:00");
  const [hours, setHours] = useState(2);
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const start = zonedTimeToUtc(date, time, venue.timezone);
    const end = new Date(start.getTime() + hours * 3_600_000);

    getPriceQuote(venue.id, start.toISOString(), end.toISOString())
      .then((data) => {
        if (!cancelled) {
          setQuote(data);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [venue.id, venue.timezone, date, time, hours, version]);

  return (
    <div className="mt-5 rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-900">{t("pricing.calculator")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${inputWidth("w-auto")}`} aria-label={t("common.date")} />
        <input type="time" step={900} value={time} onChange={(e) => e.target.value && setTime(e.target.value)} className={`${inputWidth("w-auto")}`} aria-label={t("browse.startTime")} />
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={`${inputWidth("w-auto")}`} aria-label={t("picker.length")}>
          {[1, 1.5, 2, 3, 4].map((value) => (
            <option key={value} value={value}>{t("common.hours", { count: value })}</option>
          ))}
        </select>
      </div>
      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
      {quote ? (
        <div className="mt-3 text-sm">
          {quote.breakdown.map((line) => (
            <div key={line.start} className="flex justify-between gap-3 text-slate-600">
              <span>{line.label} · {formatTime(line.start, venue.timezone)}–{formatTime(line.end, venue.timezone)} · ₹{line.ratePerHour}/h</span>
              <span>₹{line.amount.toFixed(2)}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 font-semibold text-slate-900">
            <span>{t("pricing.customerPays")}</span>
            <span>₹{quote.total.toFixed(2)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const PRESETS: { label: MessageKey; tiers: CancellationTier[] | null }[] = [
  { label: "policy.flexible", tiers: null },
  { label: "policy.moderate", tiers: [{ hoursBefore: 24, refundPercent: 100 }, { hoursBefore: 6, refundPercent: 50 }] },
  { label: "policy.strict", tiers: [{ hoursBefore: 48, refundPercent: 50 }] },
];

function CancellationPolicy({ venue, onSaved }: { venue: VenueDetails; onSaved: (venue: VenueDetails) => void }) {
  const { t } = useI18n();
  const [tiers, setTiers] = useState<CancellationTier[]>(venue.cancellationPolicy ?? []);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const sorted = [...tiers].sort((a, b) => b.hoursBefore - a.hoursBefore);

  async function save() {
    setStatus(null);
    try {
      const policy = tiers.length === 0 ? null : sorted;
      await updateVenue(venue.id, { cancellationPolicy: policy });
      onSaved({ ...venue, cancellationPolicy: policy });
      setStatus({ tone: "success", text: t("policy.saved") });
    } catch (error) {
      setStatus({ tone: "error", text: getErrorMessage(error) });
    }
  }

  const update = (index: number, change: Partial<CancellationTier>) =>
    setTiers((current) => current.map((tier, i) => (i === index ? { ...tier, ...change } : tier)));

  return (
    <section className={card}>
      <h2 className="text-lg font-semibold text-slate-900">{t("policy.title")}</h2>
      <p className="mt-1 text-sm text-slate-500">
        {t("policy.hint")}
      </p>
      {status ? <div className={`mt-4 ${status.tone === "success" ? alertSuccess : alertError}`}>{status.text}</div> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button key={preset.label} type="button" onClick={() => setTiers(preset.tiers ?? [])} className={btnSecondary}>
            {t(preset.label)}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {tiers.length === 0 ? (
          <p className="text-sm text-slate-600">{t("policy.full")}</p>
        ) : (
          tiers.map((tier, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
              <span>{t("policy.atLeast")}</span>
              <input type="number" min={0} max={720} value={tier.hoursBefore} onChange={(e) => update(index, { hoursBefore: Number(e.target.value) })} className={`${inputWidth("w-20")}`} aria-label={t("policy.hoursBefore")} />
              <span>{t("policy.hoursBeforeArrow")}</span>
              <input type="number" min={0} max={100} value={tier.refundPercent} onChange={(e) => update(index, { refundPercent: Number(e.target.value) })} className={`${inputWidth("w-20")}`} aria-label={t("policy.refundPercent")} />
              <span>{t("policy.percentRefund")}</span>
              <button type="button" onClick={() => setTiers((current) => current.filter((_, i) => i !== index))} className="text-rose-600 hover:underline">
                {t("common.remove")}
              </button>
            </div>
          ))
        )}
        {tiers.length > 0 ? <p className="text-sm text-slate-500">{t("policy.later")}</p> : null}
      </div>

      <div className="mt-4 flex gap-2">
        <button type="button" disabled={tiers.length >= 5} onClick={() => setTiers((current) => [...current, { hoursBefore: 12, refundPercent: 50 }])} className={btnSecondary}>
          {t("policy.addTier")}
        </button>
        <button type="button" onClick={save} className={btnPrimary}>{t("policy.save")}</button>
      </div>
    </section>
  );
}

function VenuePricing() {
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
      <PageHeader title={venue ? t("pricing.title", { name: venue.name }) : t("pvenues.pricing")} description={t("pricing.subtitle")} />
      {id ? <VenueTabs venueId={id} /> : null}
      {error ? <div className={alertError}>{error}</div> : null}
      {venue ? (
        <div className="space-y-6">
          <PricingRules venue={venue} />
          <CancellationPolicy venue={venue} onSaved={setVenue} />
        </div>
      ) : !error ? (
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      ) : null}
    </div>
  );
}

export default VenuePricing;
