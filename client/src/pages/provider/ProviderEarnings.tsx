import { useState } from "react";
import PageHeader from "../../components/ui/PageHeader";
import Pager from "../../components/ui/Pager";
import { useLoad } from "../../hooks/useLoad";
import { useI18n } from "../../i18n/useI18n";
import { currentLocale, translate } from "../../i18n/translate";
import { localDateKey, rupees } from "../../lib/admin";
import { formatDateTime } from "../../lib/datetime";
import { alertError, card, inputWidth, tableCard } from "../../lib/ui";
import { getProviderEarnings } from "../../services/payment.api";

const RANGES = [7, 30, 90, 365];
const money = (paise: number) => rupees(paise / 100);
const th = "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={card}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

/** Online payments for the provider's venues: what they earned and what's still to be paid out. */
export default function ProviderEarnings() {
  const { t } = useI18n();
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);
  const [today] = useState(() => new Date());
  const from = localDateKey(new Date(today.getTime() - (days - 1) * 86_400_000));
  const to = localDateKey(today);

  const { data, loading, error } = useLoad(
    `${from}:${to}:${page}`,
    () => getProviderEarnings({ from, to, page, limit: 20 }),
    translate("earn.loadFailed")
  );

  return (
    <div>
      <PageHeader title={t("nav.earnings")} description={t("earn.subtitle")} />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <select
          value={days}
          onChange={(event) => {
            setDays(Number(event.target.value));
            setPage(1);
          }}
          className={inputWidth("w-auto")}
          aria-label={t("panal.range")}
        >
          {RANGES.map((count) => (
            <option key={count} value={count}>
              {count === 365 ? t("aanal.last12Months") : t("panal.lastDays", { count })}
            </option>
          ))}
        </select>
        {loading ? <span className="text-sm text-slate-400">{t("panal.updating")}</span> : null}
      </div>

      {error ? <div className={`${alertError} mb-4`}>{error}</div> : null}

      {data ? (
        <div className={`space-y-6 ${loading ? "opacity-60" : ""}`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label={t("earn.sales")} value={money(data.sales.grossPaise)} />
            <Tile label={t("earn.refunds")} value={money(Math.abs(data.refunds.grossPaise))} />
            <Tile label={t("earn.commission")} value={money(data.period.commissionPaise)} />
            <Tile label={t("earn.yourShare")} value={money(data.period.providerSharePaise)} />
          </div>

          <section className={`${card} flex flex-wrap items-center justify-between gap-3`}>
            <div>
              <p className="text-sm text-slate-500">{t("earn.toBePaid")}</p>
              <p className="text-2xl font-semibold text-brand-700">{money(data.unpaid.providerSharePaise)}</p>
              <p className="text-xs text-slate-400">{t("earn.toBePaidHint")}</p>
            </div>
            {data.payouts[0] ? (
              <p className="text-sm text-slate-600">
                {t("earn.lastPayout", {
                  amount: money(data.payouts[0].amountPaise),
                  date: new Date(data.payouts[0].createdAt).toLocaleDateString(currentLocale()),
                })}
                {data.payouts[0].reference ? ` · ${data.payouts[0].reference}` : ""}
              </p>
            ) : null}
          </section>

          <div className={tableCard}>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>{t("detail.when")}</th>
                    <th className={th}>{t("earn.booking")}</th>
                    <th className={`${th} text-right`}>{t("earn.amount")}</th>
                    <th className={`${th} text-right`}>{t("earn.commissionShort")}</th>
                    <th className={`${th} text-right`}>{t("earn.yourShare")}</th>
                    <th className={th}>{t("earn.payout")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data.entries.map((entry) => (
                    <tr key={entry.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                        {new Date(entry.createdAt).toLocaleString(currentLocale())}
                        <span className={`block text-xs font-semibold ${entry.type === "SALE" ? "text-brand-700" : "text-rose-700"}`}>
                          {t(entry.type === "SALE" ? "earn.sale" : "earn.refund")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {entry.booking ? (
                          <>
                            <span className="font-medium text-slate-900">{entry.booking.venue.name}</span>
                            <span className="block text-xs text-slate-500">
                              {entry.booking.user.name} · {formatDateTime(entry.booking.startTime, entry.booking.venue.timezone)}
                              {entry.booking.bookingCode ? ` · ${entry.booking.bookingCode}` : ""}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{money(entry.grossPaise)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-500">{money(entry.commissionPaise)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-900">{money(entry.providerSharePaise)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {entry.payout
                          ? t("earn.paidOut", { date: new Date(entry.payout.createdAt).toLocaleDateString(currentLocale()) })
                          : t("earn.notYet")}
                      </td>
                    </tr>
                  ))}
                  {data.entries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        {t("earn.none")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          <Pager pagination={data.pagination} onPageChange={setPage} disabled={loading} />
        </div>
      ) : null}
    </div>
  );
}
