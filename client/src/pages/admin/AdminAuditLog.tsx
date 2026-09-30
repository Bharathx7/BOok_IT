import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import PageHeader from "../../components/ui/PageHeader";
import Pager from "../../components/ui/Pager";
import { AuditChanges } from "../../components/admin/AdminBits";
import { useLoad } from "../../hooks/useLoad";
import { getAuditLogs, type AuditEntry } from "../../services/admin.api";
import { actionLabel } from "../../lib/admin";
import { alertError, btnSecondary, tableCard, inputWidth } from "../../lib/ui";
import { useI18n } from "../../i18n/useI18n";
import Trans from "../../i18n/Trans";
import { currentLocale, translate, translateOr } from "../../i18n/translate";

const th = "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const FILTERS = ["action", "entityType", "entityId", "actorId", "from", "to"] as const;
const ENTITY_TYPES = ["User", "Venue", "Review", "Coupon", "Booking", "Refund", "Payout", "PlatformSetting"];

/** Where an entry's subject can be looked at, if anywhere. */
function entityLink(entry: AuditEntry) {
  if (!entry.entityId) return null;
  if (entry.entityType === "User") return `/admin/users/${entry.entityId}`;
  return null;
}

export default function AdminAuditLog() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, params.get(key) ?? ""])) as Record<(typeof FILTERS)[number], string>;

  const { data, loading, error } = useLoad(
    `${params.toString()}:${page}`,
    () => getAuditLogs({ ...filters, page }),
    translate("alog.loadFailed")
  );

  const setFilter = (key: (typeof FILTERS)[number], value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
    setPage(1);
  };

  const hasFilters = FILTERS.some((key) => filters[key]);

  return (
    <div>
      <PageHeader title={t("nav.auditLog")} description={t("alog.subtitle")} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={filters.action} onChange={(e) => setFilter("action", e.target.value)} className={`${inputWidth("w-auto")}`} aria-label={t("alog.action")}>
          <option value="">{t("alog.allActions")}</option>
          {[...new Set((data?.actions ?? []).map((action) => `${action.split(".")[0]}.`))].map((group) => (
            <option key={group} value={group}>{t("alog.groupActions", { group: translateOr(`entityGroup.${group.slice(0, -1)}`, group.slice(0, -1)) })}</option>
          ))}
          {(data?.actions ?? []).map((action) => (
            <option key={action} value={action}>{actionLabel(action)}</option>
          ))}
        </select>
        <select value={filters.entityType} onChange={(e) => setFilter("entityType", e.target.value)} className={`${inputWidth("w-auto")}`} aria-label={t("alog.recordType")}>
          <option value="">{t("alog.anyRecord")}</option>
          {ENTITY_TYPES.map((type) => (
            <option key={type} value={type}>{translateOr(`entityType.${type}`, type)}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm text-slate-500">
          {t("common.from")}
          <input type="date" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} className={`${inputWidth("w-auto")}`} />
        </label>
        <label className="flex items-center gap-1 text-sm text-slate-500">
          {t("common.to")}
          <input type="date" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} className={`${inputWidth("w-auto")}`} />
        </label>
        {hasFilters ? (
          <button type="button" onClick={() => { setParams({}); setPage(1); }} className={btnSecondary}>
            {t("alog.clear")}
          </button>
        ) : null}
        {loading ? <span className="text-sm text-slate-400">{t("common.loading")}</span> : null}
      </div>

      {filters.entityId || filters.actorId ? (
        <p className="mb-3 text-sm text-slate-600">
          <Trans
            k={filters.entityId && filters.actorId ? "alog.showingBoth" : filters.entityId ? "alog.showingAbout" : "alog.showingBy"}
            values={{
              id: <code className="rounded bg-slate-100 px-1">{filters.entityId}</code>,
              admin: (
                <Link to={`/admin/users/${filters.actorId}`} className="text-brand-700 hover:underline">
                  {t("alog.thisAdmin")}
                </Link>
              ),
            }}
          />
        </p>
      ) : null}

      {error ? <div className={`${alertError} mb-4`}>{error}</div> : null}

      <div className={tableCard}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>{t("detail.when")}</th>
                <th className={th}>{t("alog.who")}</th>
                <th className={th}>{t("alog.action")}</th>
                <th className={th}>{t("alog.record")}</th>
                <th className={th}>{t("common.reason")}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {data?.logs.map((entry) => {
                const link = entityLink(entry);
                const expanded = open === entry.id;
                return (
                  <Fragment key={entry.id}>
                    <tr className="align-top hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{new Date(entry.createdAt).toLocaleString(currentLocale())}</td>
                      <td className="px-4 py-3">
                        {entry.actor ? (
                          <Link to={`/admin/users/${entry.actor.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">{entry.actor.name}</Link>
                        ) : (
                          <span className="text-slate-700">{entry.actorEmail ?? t("alog.system")}</span>
                        )}
                        {entry.ip ? <span className="block text-xs text-slate-400">{entry.ip}</span> : null}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{actionLabel(entry.action)}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {translateOr(`entityType.${entry.entityType}`, entry.entityType)}
                        {entry.entityId ? (
                          link ? (
                            <Link to={link} className="block font-mono text-xs text-brand-700 hover:underline">{entry.entityId.slice(0, 8)}</Link>
                          ) : (
                            <button type="button" onClick={() => setFilter("entityId", entry.entityId!)} className="block font-mono text-xs text-slate-400 hover:text-brand-700" title={t("alog.showRecord")}>
                              {entry.entityId.slice(0, 8)}
                            </button>
                          )
                        ) : null}
                      </td>
                      <td className="max-w-xs px-4 py-3 text-slate-600">{entry.reason ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        {entry.before || entry.after ? (
                          <button type="button" onClick={() => setOpen(expanded ? null : entry.id)} aria-expanded={expanded} className="font-semibold text-brand-700 hover:underline">
                            {expanded ? t("pvenues.hide") : t("alog.changes")}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {expanded ? (
                      <tr>
                        <td colSpan={6} className="bg-slate-50 px-4 py-3">
                          <AuditChanges before={entry.before} after={entry.after} />
                          {entry.userAgent ? <p className="mt-2 text-xs text-slate-400">{entry.userAgent}</p> : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {data && data.logs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">{t("alog.none")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <Pager pagination={data?.pagination ?? null} onPageChange={setPage} disabled={loading} />
    </div>
  );
}
