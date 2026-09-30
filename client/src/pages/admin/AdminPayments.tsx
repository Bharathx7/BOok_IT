import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import PageHeader from "../../components/ui/PageHeader";
import Pager from "../../components/ui/Pager";
import { Badge, type Tone } from "../../components/admin/AdminBits";
import StatusBadge from "../../components/ui/StatusBadge";
import { useLoad } from "../../hooks/useLoad";
import { useI18n } from "../../i18n/useI18n";
import { currentLocale, translate } from "../../i18n/translate";
import { localDateKey, rupees } from "../../lib/admin";
import { formatDateTime } from "../../lib/datetime";
import { getErrorMessage } from "../../lib/errors";
import { alertError, alertSuccess, btnPrimary, btnSecondary, card, input, inputWidth, tableCard } from "../../lib/ui";
import {
  getAdminPayments,
  getPaymentsSummary,
  getPayouts,
  recordPayout,
  retryRefund,
  type PaymentStatus,
  type PayoutBalance,
} from "../../services/payment.api";

const money = (paise: number) => rupees(paise / 100);
const th = "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const dateText = (value: string) => new Date(value).toLocaleString(currentLocale());

const STATUS_TONE: Record<PaymentStatus, Tone> = {
  CREATED: "grey",
  AUTHORIZED: "amber",
  CAPTURED: "green",
  FAILED: "red",
  PARTIALLY_REFUNDED: "blue",
  REFUNDED: "blue",
};
const STATUSES = Object.keys(STATUS_TONE) as PaymentStatus[];

function PaymentBadge({ status }: { status: PaymentStatus }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[status]}>{t(`paymentStatus.${status}`)}</Badge>;
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={card}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

/** Money in and out, and anything that doesn't add up. */
function Overview() {
  const { t } = useI18n();
  const [today] = useState(() => new Date());
  const [days, setDays] = useState(30);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const from = localDateKey(new Date(today.getTime() - (days - 1) * 86_400_000));
  const to = localDateKey(today);
  const { data, loading, error, reload } = useLoad(`${from}:${to}`, () => getPaymentsSummary(from, to), translate("apay.loadFailed"));

  async function retry(id: string) {
    setNotice(null);
    try {
      await retryRefund(id);
      setNotice({ tone: "success", text: t("apay.retried") });
      reload();
    } catch (err) {
      setNotice({ tone: "error", text: getErrorMessage(err) });
    }
  }

  const issues = data?.issues;
  const issueCount = issues
    ? issues.orphanPayments.length + issues.unpaidConfirmed.length + issues.stuckRefunds.length + issues.failedRefunds.length + issues.failedWebhooks.length
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputWidth("w-auto")} aria-label={t("panal.range")}>
          {[7, 30, 90].map((count) => (
            <option key={count} value={count}>{t("panal.lastDays", { count })}</option>
          ))}
        </select>
        {loading ? <span className="text-sm text-slate-400">{t("panal.updating")}</span> : null}
      </div>
      {error ? <div className={alertError}>{error}</div> : null}
      {notice ? <div className={notice.tone === "success" ? alertSuccess : alertError}>{notice.text}</div> : null}

      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label={t("apay.collected")} value={money(data.capturedPaise)} hint={t("apay.payments", { count: data.capturedCount })} />
            <Tile label={t("apay.refunded")} value={money(data.refundedPaise)} hint={t("apay.refundsCount", { count: data.refundedCount })} />
            <Tile label={t("apay.net")} value={money(data.netPaise)} />
            <Tile label={t("aanal.commission")} value={money(data.commissionPaise)} hint={t("apay.providersShare", { amount: money(data.providerSharePaise) })} />
          </div>

          {data.byMethod.length > 0 ? (
            <section className={card}>
              <h2 className="text-sm font-semibold text-slate-900">{t("apay.byMethod")}</h2>
              <ul className="mt-2 flex flex-wrap gap-4 text-sm text-slate-600">
                {data.byMethod.map((row) => (
                  <li key={row.method}>
                    <span className="font-medium uppercase text-slate-900">{row.method}</span> {money(row.amountPaise)} · {row.count}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className={card}>
            <h2 className="text-lg font-semibold text-slate-900">{t("apay.checks")}</h2>
            {issueCount === 0 ? (
              <p className="mt-2 text-sm text-brand-700">{t("apay.allGood")}</p>
            ) : (
              <div className="mt-3 space-y-4 text-sm">
                {issues!.orphanPayments.length > 0 ? (
                  <div>
                    <p className="font-medium text-rose-700">{t("apay.orphans")}</p>
                    <ul className="mt-1 space-y-1 text-slate-600">
                      {issues!.orphanPayments.map((p) => (
                        <li key={p.id}>{money(p.amountPaise)} · {p.booking.bookingCode ?? p.booking.id.slice(0, 8)} · <StatusBadge status={p.booking.status} /> · <code>{p.gatewayPaymentId}</code></li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {issues!.unpaidConfirmed.length > 0 ? (
                  <div>
                    <p className="font-medium text-rose-700">{t("apay.unpaidConfirmed")}</p>
                    <ul className="mt-1 space-y-1 text-slate-600">
                      {issues!.unpaidConfirmed.map((b) => (
                        <li key={b.id}>
                          <Link to={`/admin/bookings?q=${encodeURIComponent(b.bookingCode ?? b.id)}`} className="font-mono text-brand-700 hover:underline">{b.bookingCode ?? b.id.slice(0, 8)}</Link> · {rupees(b.totalPrice)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {issues!.failedRefunds.length > 0 ? (
                  <div>
                    <p className="font-medium text-rose-700">{t("apay.failedRefunds")}</p>
                    <ul className="mt-1 space-y-2 text-slate-600">
                      {issues!.failedRefunds.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-2">
                          {money(r.amountPaise)} · {r.payment.booking.bookingCode ?? r.payment.booking.id.slice(0, 8)} · {r.failureReason}
                          <button type="button" onClick={() => void retry(r.id)} className="font-semibold text-brand-700 hover:underline">{t("apay.retry")}</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {issues!.stuckRefunds.length > 0 ? (
                  <div>
                    <p className="font-medium text-amber-800">{t("apay.stuckRefunds")}</p>
                    <ul className="mt-1 space-y-1 text-slate-600">
                      {issues!.stuckRefunds.map((r) => (
                        <li key={r.id}>{money(r.amountPaise)} · {t("apay.attempts", { count: r.attempts })} · {dateText(r.createdAt)}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {issues!.failedWebhooks.length > 0 ? (
                  <div>
                    <p className="font-medium text-amber-800">{t("apay.failedWebhooks")}</p>
                    <ul className="mt-1 space-y-1 text-slate-600">
                      {issues!.failedWebhooks.map((w) => (
                        <li key={w.id}>{w.event} · {dateText(w.receivedAt)} · {w.error}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function PaymentsList() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, loading, error } = useLoad(
    JSON.stringify({ page, status, q }),
    () => getAdminPayments({ page, ...(status && { status }), ...(q && { q }) }),
    translate("apay.loadFailed")
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("apay.searchPlaceholder")}
          aria-label={t("apay.search")}
          className={inputWidth("w-72")}
        />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={inputWidth("w-auto")} aria-label={t("common.status")}>
          <option value="">{t("ausers.anyStatus")}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>{t(`paymentStatus.${value}`)}</option>
          ))}
        </select>
        {loading ? <span className="text-sm text-slate-400">{t("common.loading")}</span> : null}
      </div>
      {error ? <div className={`${alertError} mb-4`}>{error}</div> : null}
      <div className={tableCard}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>{t("common.date")}</th>
                <th className={th}>{t("common.customer")}</th>
                <th className={th}>{t("earn.booking")}</th>
                <th className={`${th} text-right`}>{t("earn.amount")}</th>
                <th className={th}>{t("common.status")}</th>
                <th className={th}>{t("apay.gatewayIds")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {data?.items.map((payment) => (
                <tr key={payment.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{dateText(payment.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Link to={`/admin/users/${payment.booking.user.id}`} className="font-medium text-slate-900 hover:underline">{payment.booking.user.name}</Link>
                    <span className="block text-xs text-slate-500">{payment.booking.user.email}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {payment.booking.venue.name}
                    <span className="block text-xs text-slate-500">
                      {payment.booking.bookingCode ?? "—"} · {formatDateTime(payment.booking.startTime, payment.booking.venue.timezone)}
                    </span>
                    <StatusBadge status={payment.booking.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {money(payment.amountPaise)}
                    {payment.refundedPaise > 0 ? <span className="block text-xs text-slate-500">−{money(payment.refundedPaise)}</span> : null}
                    {payment.method ? <span className="block text-xs uppercase text-slate-400">{payment.method}</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    <PaymentBadge status={payment.status} />
                    {payment.failureReason ? <span className="mt-1 block text-xs text-rose-700">{payment.failureReason}</span> : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {payment.gatewayOrderId}
                    {payment.gatewayPaymentId ? <span className="block">{payment.gatewayPaymentId}</span> : null}
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">{t("apay.none")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <Pager pagination={data?.pagination ?? null} onPageChange={setPage} disabled={loading} />
    </div>
  );
}

function PayoutRow({ balance, onDone }: { balance: PayoutBalance; onDone: (text: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const payout = await recordPayout({ providerId: balance.provider.id, ...(reference.trim() && { reference: reference.trim() }) });
      onDone(t("apay.payoutRecorded", { amount: money(payout.amountPaise), name: balance.provider.name }));
    } catch (err) {
      setError(getErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <Link to={`/admin/users/${balance.provider.id}`} className="font-medium text-slate-900 hover:underline">{balance.provider.name}</Link>
          <span className="block text-xs text-slate-500">{balance.provider.email} · {t("apay.entries", { count: balance.entries })}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="text-lg font-semibold text-slate-900">{money(balance.duePaise)}</span>
          {balance.duePaise > 0 && !open ? (
            <button type="button" onClick={() => setOpen(true)} className={btnSecondary}>{t("apay.markPaid")}</button>
          ) : null}
        </span>
      </div>
      {open ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3">
          <label className="min-w-56 flex-1 text-sm font-medium text-slate-700">
            {t("apay.reference")}
            <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} className={`${input} mt-1`} placeholder="NEFT / UTR / UPI ref" />
          </label>
          <button type="button" onClick={() => void submit()} disabled={busy} className={btnPrimary}>
            {busy ? t("common.saving") : t("apay.confirmPaid", { amount: money(balance.duePaise) })}
          </button>
          <button type="button" onClick={() => setOpen(false)} disabled={busy} className={btnSecondary}>{t("common.cancel")}</button>
          {error ? <p className="w-full text-sm text-rose-700">{error}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

function Payouts() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const { data, loading, error, reload } = useLoad(`payouts:${page}`, () => getPayouts({ page }), translate("apay.loadFailed"));

  return (
    <div className="space-y-6">
      {notice ? <div className={alertSuccess}>{notice}</div> : null}
      {error ? <div className={alertError}>{error}</div> : null}
      <section className={card}>
        <h2 className="text-lg font-semibold text-slate-900">{t("apay.owed")}</h2>
        <p className="mt-1 text-sm text-slate-500">{t("apay.owedHint")}</p>
        {data && data.balances.length === 0 ? <p className="mt-3 text-sm text-slate-500">{t("apay.nothingOwed")}</p> : null}
        <ul className="mt-2 divide-y divide-slate-100">
          {data?.balances.map((balance) => (
            <PayoutRow
              key={balance.provider.id}
              balance={balance}
              onDone={(text) => {
                setNotice(text);
                reload();
              }}
            />
          ))}
        </ul>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold text-slate-900">{t("apay.history")}</h2>
        {loading && !data ? <p className="mt-2 text-sm text-slate-500">{t("common.loading")}</p> : null}
        {data && data.payouts.length === 0 ? <p className="mt-2 text-sm text-slate-500">{t("apay.noPayouts")}</p> : null}
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {data?.payouts.map((payout) => (
            <li key={payout.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>{payout.provider?.name ?? "—"}{payout.reference ? ` · ${payout.reference}` : ""}</span>
              <span className="text-slate-500">{money(payout.amountPaise)} · {dateText(payout.createdAt)}</span>
            </li>
          ))}
        </ul>
        <Pager pagination={data?.pagination ?? null} onPageChange={setPage} disabled={loading} />
      </section>
    </div>
  );
}

const TABS = ["overview", "payments", "payouts"] as const;

export default function AdminPayments() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as (typeof TABS)[number]) : "overview";

  return (
    <div>
      <PageHeader title={t("nav.payments")} description={t("apay.subtitle")} />
      <div className="mb-6 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            onClick={() => setParams(item === "overview" ? {} : { tab: item })}
            className={`rounded-xl px-3 py-1.5 text-sm font-medium transition ${tab === item ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
          >
            {t(`apay.tab.${item}`)}
          </button>
        ))}
      </div>
      {tab === "overview" ? <Overview /> : tab === "payments" ? <PaymentsList /> : <Payouts />}
    </div>
  );
}
