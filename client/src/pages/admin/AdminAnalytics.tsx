import { useState } from "react";
import PageHeader from "../../components/ui/PageHeader";
import { useLoad } from "../../hooks/useLoad";
import { getPlatformAnalytics, type PlatformAnalytics } from "../../services/admin.api";
import { localDateKey, rupees } from "../../lib/admin";
import { alertError, card, inputWidth } from "../../lib/ui";
import { useI18n } from "../../i18n/useI18n";
import type { MessageKey } from "../../i18n/en";
import { currentLocale, translate } from "../../i18n/translate";

const PRESETS: { label: MessageKey; days: number }[] = [
  { label: "panal.lastDays", days: 7 },
  { label: "panal.lastDays", days: 30 },
  { label: "panal.lastDays", days: 90 },
  { label: "aanal.last12Months", days: 365 },
];

// Sequential single-hue ramp (light -> dark) for retention cells.
const RAMP = ["#eef2ff", "#e0e7ff", "#c7d2fe", "#a5b4fc", "#818cf8", "#6366f1", "#4f46e5", "#4338ca"];

const shortDate = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString(currentLocale(), { day: "numeric", month: "short", timeZone: "UTC" });

const monthLabel = (key: string) =>
  new Date(`${key}-15T12:00:00Z`).toLocaleDateString(currentLocale(), { month: "short", year: "numeric", timeZone: "UTC" });

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={card}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

/** GMV per day: one series, bars from the baseline, hover tooltip, table view. */
function GmvChart({ daily }: { daily: PlatformAnalytics["daily"] }) {
  const { t } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(...daily.map((d) => d.gmv), 1);
  const width = 720;
  const height = 200;
  const pad = { left: 56, right: 8, top: 12, bottom: 24 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slot = plotW / daily.length;
  const barW = Math.max(1, Math.min(24, slot - 2));
  const labelEvery = Math.ceil(daily.length / 8);
  const hovered = hover !== null ? daily[hover] : null;

  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{t("aanal.gmvByDay")}</h2>
        <button type="button" onClick={() => setAsTable((v) => !v)} className="text-sm font-semibold text-brand-700 hover:underline">
          {asTable ? t("panal.showChart") : t("panal.showTable")}
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-500">{t("aanal.gmvHint")}</p>

      {asTable ? (
        <div className="mt-4 max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="py-1">{t("common.date")}</th><th className="py-1 text-right">{t("nav.bookings")}</th><th className="py-1 text-right">GMV</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {daily.map((d) => (
                <tr key={d.date}><td className="py-1.5">{shortDate(d.date)}</td><td className="py-1.5 text-right">{d.bookings}</td><td className="py-1.5 text-right">{rupees(d.gmv)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-4">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={t("aanal.chartLabel")} onMouseLeave={() => setHover(null)}>
            {[0, 0.5, 1].map((f) => {
              const y = pad.top + plotH - f * plotH;
              return (
                <g key={f}>
                  <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} className="stroke-slate-200" />
                  <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize={11} className="fill-slate-400">{rupees(Math.round(max * f))}</text>
                </g>
              );
            })}
            {daily.map((d, i) => {
              const h = (d.gmv / max) * plotH;
              const x = pad.left + i * slot + (slot - barW) / 2;
              return (
                <g key={d.date}>
                  <rect x={pad.left + i * slot} y={pad.top} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
                  {h > 0 ? <rect x={x} y={pad.top + plotH - h} width={barW} height={h} rx={Math.min(3, barW / 2)} fill={hover === i ? "#4338ca" : "#6366f1"} pointerEvents="none" /> : null}
                  {i % labelEvery === 0 ? (
                    <text x={pad.left + i * slot + slot / 2} y={height - 6} textAnchor="middle" fontSize={11} className="fill-slate-400">{shortDate(d.date)}</text>
                  ) : null}
                </g>
              );
            })}
            <line x1={pad.left} x2={width - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} className="stroke-slate-300" />
          </svg>
          {hovered ? (
            <div
              className="pointer-events-none absolute top-0 rounded-xl bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
              style={{ left: `${((pad.left + hover! * slot + slot / 2) / width) * 100}%`, transform: "translateX(-50%)" }}
            >
              <p className="font-semibold">{shortDate(hovered.date)}</p>
              <p>{rupees(hovered.gmv)} · {hovered.bookings === 1 ? t("panal.bookingOne") : t("panal.bookingsCount", { count: hovered.bookings })}</p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Conversion({ conversion }: { conversion: PlatformAnalytics["conversion"] }) {
  const { t } = useI18n();
  const rows = [
    { label: t("aanal.converted"), value: conversion.conversionPercent, count: conversion.converted, color: "bg-brand-600" },
    { label: t("status.CANCELLED"), value: conversion.cancelledPercent, count: conversion.byStatus.CANCELLED ?? 0, color: "bg-slate-400" },
    { label: t("aanal.expired"), value: conversion.expiredPercent, count: conversion.byStatus.EXPIRED ?? 0, color: "bg-slate-300" },
  ];

  return (
    <section className={card}>
      <h2 className="text-lg font-semibold text-slate-900">{t("aanal.conversion")}</h2>
      <p className="mt-1 text-sm text-slate-500">
        {conversion.pending
          ? t("aanal.conversionHintPending", { count: conversion.requests, pending: conversion.pending })
          : t("aanal.conversionHint", { count: conversion.requests })}
      </p>
      <div className="mt-4 space-y-4">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-slate-700">{row.label}</span>
              <span className="text-slate-500">{row.value}% · {row.count}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${row.color}`} style={{ width: `${row.value}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Cohorts({ cohorts }: { cohorts: PlatformAnalytics["cohorts"] }) {
  const { t } = useI18n();
  const color = (value: number) => RAMP[Math.min(RAMP.length - 1, Math.floor((value / 100) * RAMP.length))];

  return (
    <section className={card}>
      <h2 className="text-lg font-semibold text-slate-900">{t("aanal.retention")}</h2>
      <p className="mt-1 text-sm text-slate-500">
        {t("aanal.retentionHint")}
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-400">
              <th className="py-1 pr-4">{t("aanal.signedUp")}</th>
              <th className="py-1 pr-4 text-right">{t("ausers.customers")}</th>
              {cohorts.map((_, i) => (
                <th key={i} className="w-16 py-1 text-center">{i === 0 ? t("aanal.month0") : `+${i}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((row) => (
              <tr key={row.cohort}>
                <td className="py-1 pr-4 text-slate-700">{monthLabel(row.cohort)}</td>
                <td className="py-1 pr-4 text-right text-slate-500">{row.users}</td>
                {cohorts.map((_, i) => {
                  const value = row.retention[i];
                  return (
                    <td key={i} className="p-0.5">
                      {value === undefined ? null : (
                        <div
                          className={`rounded px-2 py-1.5 text-center text-xs ${value >= 60 ? "text-white" : "text-slate-700"}`}
                          style={{ background: row.users ? color(value) : "#f8fafc" }}
                          title={t("aanal.cellTitle", { cohort: monthLabel(row.cohort), value, month: i })}
                        >
                          {row.users ? `${value}%` : "—"}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function AdminAnalytics() {
  const { t } = useI18n();
  const [today] = useState(() => new Date());
  const [days, setDays] = useState<number | "custom">(30);
  const [custom, setCustom] = useState(() => ({
    from: localDateKey(new Date(today.getTime() - 29 * 86_400_000)),
    to: localDateKey(today),
  }));

  const range =
    days === "custom"
      ? custom
      : { from: localDateKey(new Date(today.getTime() - (days - 1) * 86_400_000)), to: localDateKey(today) };

  const { data, loading, error } = useLoad(
    `${range.from}:${range.to}`,
    () => getPlatformAnalytics(range.from, range.to),
    translate("panal.loadFailed")
  );

  const s = data?.summary;

  return (
    <div>
      <PageHeader title={t("nav.analytics")} description={t("aanal.subtitle")} />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <select
          value={days}
          onChange={(e) => setDays(e.target.value === "custom" ? "custom" : Number(e.target.value))}
          className={`${inputWidth("w-auto")}`}
          aria-label={t("panal.range")}
        >
          {PRESETS.map((preset) => (
            <option key={preset.days} value={preset.days}>{t(preset.label, { count: preset.days })}</option>
          ))}
          <option value="custom">{t("aanal.custom")}</option>
        </select>
        {days === "custom" ? (
          <>
            <input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} className={`${inputWidth("w-auto")}`} aria-label={t("common.from")} />
            <span className="text-slate-400">–</span>
            <input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} className={`${inputWidth("w-auto")}`} aria-label={t("common.to")} />
          </>
        ) : null}
        {loading ? <span className="text-sm text-slate-400">{t("panal.updating")}</span> : null}
      </div>

      {error ? <div className={`${alertError} mb-4`}>{error}</div> : null}

      {data && s ? (
        <div className={`space-y-6 ${loading ? "opacity-60" : ""}`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="GMV" value={rupees(s.gmv)} hint={t("aanal.avg", { amount: rupees(s.averageBookingValue) })} />
            <StatTile label={t("aanal.bookingsMade")} value={String(s.bookings)} hint={t("aanal.walkIns", { count: s.walkIns })} />
            <StatTile label={t("aanal.commission")} value={rupees(s.estimatedCommission)} hint={t("aanal.commissionHint", { percent: s.commissionPercent })} />
            <StatTile label={t("aanal.discounts")} value={rupees(s.discounts)} hint={t("aanal.discountsHint", { count: s.couponBookings })} />
            <StatTile label={t("aanal.conversionTile")} value={`${data.conversion.conversionPercent}%`} hint={t("aanal.conversionTileHint")} />
            <StatTile label={t("aanal.newCustomers")} value={String(s.newUsers)} />
            <StatTile label={t("aanal.newProviders")} value={String(s.newProviders)} />
            <StatTile label={t("aanal.newVenues")} value={String(s.newVenues)} />
          </div>

          <GmvChart daily={data.daily} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Conversion conversion={data.conversion} />

            <section className={card}>
              <h2 className="text-lg font-semibold text-slate-900">{t("aanal.topCities")}</h2>
              {data.topCities.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{t("aanal.none")}</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="py-1">{t("browse.city")}</th><th className="py-1 text-right">{t("nav.venues")}</th><th className="py-1 text-right">{t("nav.bookings")}</th><th className="py-1 text-right">GMV</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.topCities.map((row) => (
                      <tr key={row.city}><td className="py-2 font-medium text-slate-900">{row.city}</td><td className="py-2 text-right">{row.venues}</td><td className="py-2 text-right">{row.bookings}</td><td className="py-2 text-right">{rupees(row.gmv)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <section className={card}>
            <h2 className="text-lg font-semibold text-slate-900">{t("aanal.topVenues")}</h2>
            {data.topVenues.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">{t("aanal.none")}</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="py-1">{t("common.venue")}</th><th className="py-1">{t("browse.city")}</th><th className="py-1 text-right">{t("nav.bookings")}</th><th className="py-1 text-right">GMV</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.topVenues.map((row) => (
                    <tr key={row.id}><td className="py-2 font-medium text-slate-900">{row.name}</td><td className="py-2 text-slate-500">{row.city ?? "—"}</td><td className="py-2 text-right">{row.bookings}</td><td className="py-2 text-right">{rupees(row.gmv)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <Cohorts cohorts={data.cohorts} />
        </div>
      ) : loading ? (
        <p className="text-sm text-slate-500">{t("panal.loading")}</p>
      ) : null}
    </div>
  );
}
