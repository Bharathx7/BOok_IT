import { useEffect, useState } from "react";
import PageHeader from "../../components/ui/PageHeader";
import { getMyVenues, type Venue } from "../../services/venue.api";
import { downloadBookingsCsv, getAnalytics, type Analytics } from "../../services/tools.api";
import { fetchAllPages } from "../../lib/pagination";
import { alertError, btnSecondary, card, inputWidth } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";
import { currentLocale, translate } from "../../i18n/translate";
import { weekdayShort } from "../../lib/venueOptions";

// Heatmap rows Monday first; values are the server's weekday index (0 = Sunday).
const WEEKDAY_INDEX = [1, 2, 3, 4, 5, 6, 0];

// Sequential ramp for occupancy (one hue, light -> dark).
const OCCUPANCY_STEPS = ["#eef2ff", "#e0e7ff", "#c7d2fe", "#a5b4fc", "#818cf8", "#6366f1", "#4f46e5", "#4338ca"];

const localIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const rupees = (value: number) =>
  `₹${value.toLocaleString("en-IN", { maximumFractionDigits: value < 1000 ? 2 : 0 })}`;

const shortDate = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString(currentLocale(), { day: "numeric", month: "short", timeZone: "UTC" });

const RANGES = [7, 30, 90];

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={card}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

/** Daily revenue: single series, thin bars anchored to the baseline, hover tooltip. */
function RevenueChart({ daily }: { daily: Analytics["daily"] }) {
  const { t } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(...daily.map((d) => d.revenue), 1);
  const width = 720;
  const height = 200;
  const pad = { left: 48, right: 8, top: 12, bottom: 24 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slot = plotW / daily.length;
  const barW = Math.max(2, Math.min(24, slot - 2));
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const labelEvery = Math.ceil(daily.length / 8);
  const hovered = hover !== null ? daily[hover] : null;

  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{t("panal.revenueByDay")}</h2>
        <button type="button" onClick={() => setAsTable((v) => !v)} className="text-sm font-semibold text-brand-700 hover:underline">
          {asTable ? t("panal.showChart") : t("panal.showTable")}
        </button>
      </div>

      {asTable ? (
        <div className="mt-4 max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="py-1">{t("common.date")}</th><th className="py-1 text-right">{t("nav.bookings")}</th><th className="py-1 text-right">{t("panal.revenue")}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {daily.map((d) => (
                <tr key={d.date}><td className="py-1.5">{shortDate(d.date)}</td><td className="py-1.5 text-right">{d.bookings}</td><td className="py-1.5 text-right">{rupees(d.revenue)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-4">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={t("panal.chartLabel")} onMouseLeave={() => setHover(null)}>
            {ticks.map((tick) => {
              const y = pad.top + plotH - (tick / max) * plotH;
              return (
                <g key={tick}>
                  <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} className="stroke-slate-200" strokeWidth={1} />
                  <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize={11} className="fill-slate-400">{rupees(tick)}</text>
                </g>
              );
            })}
            {daily.map((d, i) => {
              const h = (d.revenue / max) * plotH;
              const x = pad.left + i * slot + (slot - barW) / 2;
              const y = pad.top + plotH - h;
              return (
                <g key={d.date}>
                  {/* Hit target spans the whole slot, taller than the bar. */}
                  <rect x={pad.left + i * slot} y={pad.top} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
                  {h > 0 ? (
                    <path
                      d={`M${x},${pad.top + plotH} V${y + Math.min(4, h)} Q${x},${y} ${x + Math.min(4, barW / 2)},${y} H${x + barW - Math.min(4, barW / 2)} Q${x + barW},${y} ${x + barW},${y + Math.min(4, h)} V${pad.top + plotH} Z`}
                      fill={hover === i ? "#4338ca" : "#6366f1"}
                      pointerEvents="none"
                    />
                  ) : null}
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
              <p>{rupees(hovered.revenue)} · {hovered.bookings === 1 ? t("panal.bookingOne") : t("panal.bookingsCount", { count: hovered.bookings })}</p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** Weekday x hour occupancy, sequential single-hue scale. */
function OccupancyHeatmap({ heatmap }: { heatmap: Analytics["heatmap"] }) {
  const { t } = useI18n();
  const [hover, setHover] = useState<Analytics["heatmap"][number] | null>(null);
  const hoursWithData = heatmap.filter((c) => c.openHours > 0 || c.bookedHours > 0).map((c) => c.hour);
  const first = hoursWithData.length ? Math.min(...hoursWithData) : 6;
  const last = hoursWithData.length ? Math.max(...hoursWithData) : 22;
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const cell = (weekday: number, hour: number) => heatmap.find((c) => c.weekday === weekday && c.hour === hour)!;
  const share = (c: Analytics["heatmap"][number]) => (c.openHours > 0 ? Math.min(c.bookedHours / c.openHours, 1) : null);
  const color = (value: number | null) =>
    value === null ? "#f8fafc" : OCCUPANCY_STEPS[Math.min(OCCUPANCY_STEPS.length - 1, Math.floor(value * OCCUPANCY_STEPS.length))];

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{t("panal.busy")}</h2>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>0%</span>
          <span className="flex">{OCCUPANCY_STEPS.map((step) => <span key={step} className="h-3 w-4" style={{ background: step }} />)}</span>
          <span>{t("panal.fullyBooked")}</span>
          <span className="ml-2 inline-block h-3 w-4 rounded-sm bg-slate-50 ring-1 ring-slate-200" /> <span>{t("panal.closed")}</span>
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-500">{t("panal.heatHint")}</p>

      <div className="relative mt-4 overflow-x-auto">
        <table className="border-separate border-spacing-[2px] text-xs" onMouseLeave={() => setHover(null)}>
          <thead>
            <tr>
              <th />
              {hours.map((hour) => (
                <th key={hour} className="w-8 font-normal text-slate-400">{hour % 3 === 0 ? `${hour}` : ""}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAY_INDEX.map((weekday) => (
              <tr key={weekday}>
                <th className="pr-2 text-right font-normal text-slate-500">{weekdayShort(weekday)}</th>
                {hours.map((hour) => {
                  const c = cell(weekday, hour);
                  const value = share(c);
                  return (
                    <td
                      key={hour}
                      onMouseEnter={() => setHover(c)}
                      title={
                        value === null
                          ? t("panal.cellClosed", { day: weekdayShort(weekday), hour })
                          : t("panal.cellBooked", { day: weekdayShort(weekday), hour, percent: Math.round(value * 100) })
                      }
                      className="h-7 w-8 rounded"
                      style={{ background: color(value), outline: hover === c ? "2px solid #0f172a" : undefined }}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 h-5 text-sm text-slate-600" aria-live="polite">
        {hover
          ? `${weekdayShort(hover.weekday)} ${hover.hour}:00–${hover.hour + 1}:00 · ${
              hover.openHours > 0
                ? t("panal.hoverBooked", {
                    booked: hover.bookedHours,
                    open: hover.openHours,
                    percent: Math.round(Math.min(hover.bookedHours / hover.openHours, 1) * 100),
                  })
                : t("panal.closed")
            }`
          : t("panal.hoverHint")}
      </p>
    </section>
  );
}

export default function ProviderAnalytics() {
  const { t } = useI18n();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState("");
  const [days, setDays] = useState(30);
  const [result, setResult] = useState<{ key: string; data: Analytics | null; error: string }>({ key: "", data: null, error: "" });

  // Read the clock once; reports are for "today" as of opening the page.
  const [today] = useState(() => new Date());
  const to = localIso(today);
  const from = localIso(new Date(today.getTime() - (days - 1) * 86_400_000));
  const key = `${from}:${to}:${venueId}`;
  const loading = result.key !== key;

  useEffect(() => {
    let cancelled = false;
    fetchAllPages(getMyVenues)
      .then((list) => {
        if (!cancelled) setVenues(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAnalytics({ from, to, ...(venueId && { venueId }) })
      .then((data) => {
        if (!cancelled) setResult({ key, data, error: "" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setResult({ key, data: null, error: getErrorMessage(err, translate("panal.loadFailed")) });
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, venueId, key]);

  const data = result.data;

  return (
    <div>
      <PageHeader title={t("nav.analytics")} description={t("panal.subtitle")} />

      {/* Filters: one row above the charts. */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inputWidth("w-auto")}`} aria-label={t("panal.range")}>
          {RANGES.map((count) => (
            <option key={count} value={count}>{t("panal.lastDays", { count })}</option>
          ))}
        </select>
        <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className={`${inputWidth("w-auto")}`} aria-label={t("common.venue")}>
          <option value="">{t("panal.allVenues")}</option>
          {venues.map((venue) => (
            <option key={venue.id} value={venue.id}>{venue.name}</option>
          ))}
        </select>
        <button type="button" onClick={() => void downloadBookingsCsv({ from, to, ...(venueId && { venueId }) })} className={btnSecondary}>
          {t("pbook.export")}
        </button>
        {loading ? <span className="text-sm text-slate-400">{t("panal.updating")}</span> : null}
      </div>

      {result.error ? <div className={alertError}>{result.error}</div> : null}

      {data ? (
        <div className={`space-y-6 ${loading ? "opacity-60" : ""}`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label={t("panal.revenue")} value={rupees(data.summary.revenue)} hint={t("panal.revenueHint", { count: data.summary.bookings, avg: rupees(data.summary.averageBookingValue) })} />
            <StatTile label={t("panal.occupancy")} value={`${data.summary.occupancyPercent}%`} hint={t("panal.occupancyHint", { booked: data.summary.bookedHours, open: data.summary.openHours })} />
            <StatTile label={t("panal.cancelRate")} value={`${data.summary.cancellationRatePercent}%`} hint={t("panal.cancelHint", { cancelled: data.summary.byStatus.CANCELLED ?? 0, expired: data.summary.byStatus.EXPIRED ?? 0 })} />
            <StatTile label={t("panal.walkIns")} value={String(data.summary.walkIns)} hint={t("panal.walkInsHint")} />
          </div>

          <RevenueChart daily={data.daily} />
          <OccupancyHeatmap heatmap={data.heatmap} />

          <div className="grid gap-6 lg:grid-cols-2">
            <section className={card}>
              <h2 className="text-lg font-semibold text-slate-900">{t("panal.topCustomers")}</h2>
              {data.topCustomers.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{t("panal.noCustomers")}</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="py-1">{t("common.customer")}</th><th className="py-1 text-right">{t("nav.bookings")}</th><th className="py-1 text-right">{t("panal.spent")}</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.topCustomers.map((customer) => (
                      <tr key={customer.email}>
                        <td className="py-2"><span className="font-medium text-slate-900">{customer.name}</span><span className="block text-xs text-slate-400">{customer.email}</span></td>
                        <td className="py-2 text-right">{customer.bookings}</td>
                        <td className="py-2 text-right">{rupees(customer.spent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className={card}>
              <h2 className="text-lg font-semibold text-slate-900">{t("panal.ratingTrend")}</h2>
              {data.ratingTrend.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{t("panal.noRatings")}</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="py-1">{t("panal.month")}</th><th className="py-1">{t("panal.average")}</th><th className="py-1 text-right">{t("nav.reviews")}</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.ratingTrend.map((row) => (
                      <tr key={row.month}>
                        <td className="py-2">{new Date(`${row.month}-15T12:00:00Z`).toLocaleDateString(currentLocale(), { month: "short", year: "numeric", timeZone: "UTC" })}</td>
                        <td className="py-2">
                          <span className="flex items-center gap-2">
                            <span className="h-2 rounded-full bg-amber-400" style={{ width: `${(row.averageRating / 5) * 6}rem` }} />
                            <span className="text-slate-700">{row.averageRating.toFixed(1)}</span>
                          </span>
                        </td>
                        <td className="py-2 text-right">{row.reviews}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          {data.perVenue.length > 1 ? (
            <section className={card}>
              <h2 className="text-lg font-semibold text-slate-900">{t("panal.byVenue")}</h2>
              <table className="mt-3 w-full text-sm">
                <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="py-1">{t("common.venue")}</th><th className="py-1 pr-6 text-right">{t("nav.bookings")}</th><th className="py-1">{t("panal.occupancy")}</th><th className="py-1 text-right">{t("panal.revenue")}</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.perVenue.map((row) => (
                    <tr key={row.venueId}>
                      <td className="py-2 font-medium text-slate-900">{row.name}</td>
                      <td className="py-2 pr-6 text-right tabular">{row.bookings}</td>
                      <td className="py-2">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.min(row.occupancyPercent, 100)}%` }} /></span>
                          {row.occupancyPercent}%
                        </span>
                      </td>
                      <td className="py-2 text-right">{rupees(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </div>
      ) : loading && !result.error ? (
        <p className="text-sm text-slate-500">{t("panal.loading")}</p>
      ) : null}
    </div>
  );
}
