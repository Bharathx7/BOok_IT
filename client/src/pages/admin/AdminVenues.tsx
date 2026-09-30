import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import PageHeader from "../../components/ui/PageHeader";
import Pager from "../../components/ui/Pager";
import { ApprovalBadge, Badge, ReasonPrompt, UserStatusBadge } from "../../components/admin/AdminBits";
import { useLoad } from "../../hooks/useLoad";
import { getAdminVenues, reviewVenue, type AdminVenue, type ApprovalStatus } from "../../services/admin.api";
import { rupees } from "../../lib/admin";
import { getErrorMessage } from "../../lib/errors";
import { alertError, alertSuccess, btnDanger, btnPrimary, card, inputWidth } from "../../lib/ui";
import { useI18n } from "../../i18n/useI18n";
import type { MessageKey } from "../../i18n/en";
import { currentLocale, translate } from "../../i18n/translate";
import { sportLabel } from "../../lib/venueOptions";
import EmptyState from "../../components/ui/EmptyState";
import { Building2, ShieldCheck } from "lucide-react";

const TABS: { value: ApprovalStatus | ""; label: MessageKey }[] = [
  { value: "PENDING", label: "approval.PENDING" },
  { value: "REJECTED", label: "approval.REJECTED" },
  { value: "APPROVED", label: "approval.APPROVED" },
  { value: "", label: "common.all" },
];

function VenueRow({ venue, onDone }: { venue: AdminVenue; onDone: (text: string) => void }) {
  const { t } = useI18n();
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(decision: "APPROVED" | "REJECTED", reason?: string) {
    setBusy(true);
    setError("");
    try {
      await reviewVenue(venue.id, decision, reason);
      onDone(decision === "APPROVED" ? t("avenues.approved", { name: venue.name }) : t("avenues.sentBack", { name: venue.name }));
    } catch (err) {
      setError(getErrorMessage(err, t("avenues.decisionFailed")));
      setBusy(false);
    }
  }

  const cover = venue.images[0]?.url;

  return (
    <li className={`${card} flex flex-col gap-4 sm:flex-row`}>
      <div className="h-28 w-full shrink-0 overflow-hidden rounded-xl bg-slate-100 sm:w-40">
        {cover ? <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" /> : (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">{t("avenues.noPhotos")}</div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900">{venue.name}</h2>
          <ApprovalBadge status={venue.approvalStatus} />
          {venue.isActive ? null : <Badge tone="grey">{t("avenues.unlisted")}</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-slate-500">
          {sportLabel(venue.category)} · {[venue.address, venue.city].filter(Boolean).join(", ") || t("avenues.noAddress")} · {rupees(venue.pricePerHour)}{t("common.perHour")}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {t("avenues.owner")} <Link to={`/admin/users/${venue.owner.id}`} className="font-medium text-brand-700 hover:underline">{venue.owner.name}</Link>{" "}
          <span className="text-slate-400">({venue.owner.email})</span>{" "}
          {venue.owner.status !== "ACTIVE" ? <UserStatusBadge status={venue.owner.status} /> : null}
        </p>
        {venue.description ? <p className="mt-2 line-clamp-3 text-sm text-slate-600">{venue.description}</p> : null}
        <p className="mt-2 text-xs text-slate-400">
          {t("avenues.meta", {
            photos: venue.images.length ? t("avenues.hasPhotos") : t("avenues.noPhotos"),
            slots: venue._count.availability,
            bookings: venue._count.bookings,
            date: new Date(venue.createdAt).toLocaleDateString(currentLocale()),
          })}
          {venue.reviewedAt
            ? ` · ${t("avenues.lastReviewed", { date: new Date(venue.reviewedAt).toLocaleDateString(currentLocale()) })}`
            : ""}
        </p>
        {venue.approvalStatus === "REJECTED" && venue.rejectionReason ? (
          <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{t("avenues.sentBackNote", { reason: venue.rejectionReason })}</p>
        ) : null}

        {error ? <p className={`${alertError} mt-3`}>{error}</p> : null}

        {rejecting ? (
          <ReasonPrompt
            title={t("avenues.rejectPrompt")}
            placeholder={t("avenues.rejectPlaceholder")}
            confirmLabel={t("avenues.sendBack")}
            required
            danger
            busy={busy}
            onConfirm={(reason) => void decide("REJECTED", reason)}
            onCancel={() => setRejecting(false)}
          />
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {venue.approvalStatus !== "APPROVED" ? (
              <button type="button" disabled={busy} onClick={() => void decide("APPROVED")} className={btnPrimary}>
                {t("avenues.approve")}
              </button>
            ) : null}
            {venue.approvalStatus !== "REJECTED" ? (
              <button type="button" disabled={busy} onClick={() => setRejecting(true)} className={btnDanger}>
                {venue.approvalStatus === "APPROVED" ? t("avenues.takeDown") : t("avenues.reject")}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

export default function AdminVenues() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const raw = params.get("status") ?? "PENDING";
  const tab = (raw === "ALL" ? "" : raw) as ApprovalStatus | "";
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, loading, error, reload } = useLoad(
    JSON.stringify({ tab, page, q }),
    () => getAdminVenues({ approvalStatus: tab || undefined, page, q }),
    translate("browse.loadFailed")
  );

  return (
    <div>
      <PageHeader
        title={t("nav.venues")}
        description={t("avenues.subtitle")}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.label}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              onClick={() => {
                setParams(item.value === "PENDING" ? {} : { status: item.value || "ALL" });
                setPage(1);
              }}
              className={`rounded-xl px-3 py-1.5 text-sm font-medium transition ${
                tab === item.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("avenues.searchPlaceholder")}
          aria-label={t("avenues.search")}
          className={`${inputWidth("w-72")}`}
        />
        {loading ? <span className="text-sm text-slate-400">{t("common.loading")}</span> : null}
      </div>

      {notice ? <div className={`${alertSuccess} mb-4`}>{notice}</div> : null}
      {error ? <div className={`${alertError} mb-4`}>{error}</div> : null}

      {data && data.items.length === 0 ? (
        <EmptyState icon={tab === "PENDING" ? ShieldCheck : Building2} title={tab === "PENDING" ? t("avenues.queueEmpty") : t("avenues.none")} />
      ) : (
        <ul className="space-y-4">
          {data?.items.map((venue) => (
            <VenueRow
              key={`${venue.id}:${venue.approvalStatus}`}
              venue={venue}
              onDone={(text) => {
                setNotice(text);
                reload();
              }}
            />
          ))}
        </ul>
      )}

      <Pager pagination={data?.pagination ?? null} onPageChange={setPage} disabled={loading} />
    </div>
  );
}
