import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import PageHeader from "../../components/ui/PageHeader";
import Pager from "../../components/ui/Pager";
import { ReasonPrompt, ReviewStatusBadge } from "../../components/admin/AdminBits";
import { useLoad } from "../../hooks/useLoad";
import { getModerationReviews, moderateReview, type ModerationReview, type ReviewStatus } from "../../services/admin.api";
import { getErrorMessage } from "../../lib/errors";
import { alertError, alertSuccess, btnDanger, btnPrimary, card } from "../../lib/ui";
import { useI18n } from "../../i18n/useI18n";
import type { MessageKey } from "../../i18n/en";
import Trans from "../../i18n/Trans";
import { currentLocale, translate } from "../../i18n/translate";
import { StarRating } from "../../components/ui/StarRating";
import EmptyState from "../../components/ui/EmptyState";
import { MessageSquare, ShieldCheck } from "lucide-react";

const TABS: { value: ReviewStatus | "ALL"; label: MessageKey }[] = [
  { value: "FLAGGED", label: "reviewStatus.FLAGGED" },
  { value: "HIDDEN", label: "reviewStatus.HIDDEN" },
  { value: "VISIBLE", label: "reviewStatus.VISIBLE" },
  { value: "ALL", label: "common.all" },
];

function ReviewCard({ review, onDone }: { review: ModerationReview; onDone: (text: string) => void }) {
  const { t } = useI18n();
  const [hiding, setHiding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const openReports = review.reports.filter((report) => !report.resolvedAt);

  async function act(status: "HIDDEN" | "VISIBLE", note?: string) {
    setBusy(true);
    setError("");
    try {
      await moderateReview(review.id, status, note);
      onDone(status === "HIDDEN" ? t("arev.hidden") : t("arev.visible"));
    } catch (err) {
      setError(getErrorMessage(err, t("arev.failed")));
      setBusy(false);
    }
  }

  return (
    <li className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StarRating rating={review.rating} size={14} />
          <span className="font-medium text-slate-900">{review.venue.name}</span>
          <ReviewStatusBadge status={review.status} />
        </div>
        <span className="text-xs text-slate-400">{new Date(review.createdAt).toLocaleDateString(currentLocale())}</span>
      </div>

      <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{review.review || <em className="text-slate-400">{t("arev.noText")}</em>}</p>
      <p className="mt-1 text-xs text-slate-500">
        <Trans
          k="arev.by"
          values={{
            name: <Link to={`/admin/users/${review.user.id}`} className="font-medium text-brand-700 hover:underline">{review.user.name}</Link>,
            email: review.user.email,
          }}
        />
      </p>
      {review.providerReply ? <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{t("arev.ownerReplied", { reply: review.providerReply })}</p> : null}

      {review.reports.length > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            {review.reports.length === 1 ? t("arev.report") : t("arev.reports", { count: review.reports.length })}
            {openReports.length && openReports.length !== review.reports.length ? ` · ${t("arev.open", { count: openReports.length })}` : ""}
          </p>
          <ul className="mt-1 space-y-1 text-sm">
            {review.reports.map((report) => (
              <li key={report.id} className={report.resolvedAt ? "text-slate-400" : "text-slate-700"}>
                “{report.reason}” — {report.reporter.name}, {new Date(report.createdAt).toLocaleDateString(currentLocale())}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {review.status === "HIDDEN" && review.moderationNote ? (
        <p className="mt-2 text-xs text-slate-500">{t("arev.hiddenBecause", { note: review.moderationNote })}</p>
      ) : null}

      {error ? <p className={`${alertError} mt-3`}>{error}</p> : null}

      {hiding ? (
        <ReasonPrompt
          title={t("arev.hidePrompt")}
          placeholder={t("arev.hidePlaceholder")}
          confirmLabel={t("arev.hideReview")}
          danger
          busy={busy}
          onConfirm={(note) => void act("HIDDEN", note)}
          onCancel={() => setHiding(false)}
        />
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {review.status !== "HIDDEN" ? (
            <button type="button" disabled={busy} onClick={() => setHiding(true)} className={btnDanger}>
              {t("pvenues.hide")}
            </button>
          ) : null}
          {review.status !== "VISIBLE" ? (
            <button type="button" disabled={busy} onClick={() => void act("VISIBLE")} className={btnPrimary}>
              {review.status === "FLAGGED" ? t("arev.keep") : t("arev.restore")}
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}

export default function AdminReviews() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("status") ?? "FLAGGED") as ReviewStatus | "ALL";
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");

  const { data, loading, error, reload } = useLoad(
    `${tab}:${page}`,
    () => getModerationReviews({ page, status: tab === "ALL" ? undefined : tab }),
    translate("arev.loadFailed")
  );

  return (
    <div>
      <PageHeader
        title={t("nav.reviews")}
        description={t("arev.subtitle")}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              onClick={() => {
                setParams(item.value === "FLAGGED" ? {} : { status: item.value });
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
        {loading ? <span className="text-sm text-slate-400">{t("common.loading")}</span> : null}
      </div>

      {notice ? <div className={`${alertSuccess} mb-4`}>{notice}</div> : null}
      {error ? <div className={`${alertError} mb-4`}>{error}</div> : null}

      {data && data.items.length === 0 ? (
        <EmptyState icon={tab === "FLAGGED" ? ShieldCheck : MessageSquare} title={tab === "FLAGGED" ? t("arev.queueEmpty") : t("arev.none")} />
      ) : (
        <ul className="space-y-4">
          {data?.items.map((review) => (
            <ReviewCard
              key={`${review.id}:${review.status}`}
              review={review}
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
