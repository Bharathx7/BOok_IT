import { useEffect, useState } from "react";
import PageHeader from "../../components/ui/PageHeader";
import Pager from "../../components/ui/Pager";
import {
  deleteReviewReply,
  listProviderReviews,
  replyToReview,
  type ProviderReview,
} from "../../services/tools.api";
import type { Pagination } from "../../lib/pagination";
import { timeAgo } from "../../lib/datetime";
import { alertError, btnPrimary, btnSecondary, card, initials, input } from "../../lib/ui";
import { getErrorMessage } from "../../lib/errors";
import { useI18n } from "../../i18n/useI18n";
import Trans from "../../i18n/Trans";
import { StarRating } from "../../components/ui/StarRating";
import EmptyState from "../../components/ui/EmptyState";
import SegmentedControl from "../../components/ui/SegmentedControl";
import { Skeleton } from "../../components/ui/Skeleton";
import { MessageSquare, MessageSquareCheck, MessageSquareDashed, Pencil, Reply, Send, Trash2 } from "lucide-react";

function ReviewItem({ review, onChange }: { review: ProviderReview; onChange: (review: ProviderReview) => void }) {
  const { t } = useI18n();
  // The reply box stays closed until asked for, so a page of reviews stays scannable.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(review.providerReply ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      await replyToReview(review.id, draft.trim());
      onChange({ ...review, providerReply: draft.trim(), providerRepliedAt: new Date().toISOString() });
      setEditing(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("prev.confirmRemove"))) return;
    await deleteReviewReply(review.id);
    onChange({ ...review, providerReply: null, providerRepliedAt: null });
    setDraft("");
  }

  return (
    <li className={`${card} flex gap-4`}>
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
        {initials(review.user.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <p className="font-semibold text-slate-900">
            <Trans k="prev.on" values={{ name: review.user.name, venue: <span className="font-normal text-slate-500">{review.venue.name}</span> }} />
          </p>
          <span className="text-xs text-slate-500">{timeAgo(review.createdAt)}</span>
        </div>
        <div className="mt-1">
          <StarRating rating={review.rating} size={14} />
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-700">{review.review || <em className="text-slate-500">{t("prev.noText")}</em>}</p>

        {error ? <div className={`mt-3 ${alertError}`}>{error}</div> : null}

        {editing ? (
          <div className="mt-4 space-y-2">
            <textarea
              rows={3}
              maxLength={1000}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("prev.placeholder")}
              aria-label={t("prev.reply")}
              className={input}
            />
            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={saving || !draft.trim()} className={btnPrimary}>
                <Send aria-hidden="true" className="h-4 w-4" />
                {saving ? t("common.saving") : t("prev.post")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(review.providerReply ?? "");
                  setEditing(false);
                }}
                className={btnSecondary}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : review.providerReply ? (
          <div className="mt-3 rounded-xl border-l-4 border-brand-300 bg-slate-50 px-4 py-3 text-sm">
            <p className="text-xs font-semibold text-brand-700">
              {t("prev.yourReply")}
              {review.providerRepliedAt ? <span className="font-normal text-slate-500"> · {timeAgo(review.providerRepliedAt)}</span> : null}
            </p>
            <p className="mt-1 text-slate-700">{review.providerReply}</p>
            <div className="mt-2 flex gap-1 text-xs font-semibold">
              <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-brand-700 transition hover:bg-brand-50">
                <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                {t("common.edit")}
              </button>
              <button type="button" onClick={remove} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-rose-700 transition hover:bg-rose-50">
                <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                {t("common.remove")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className={`${btnSecondary} mt-3 px-3! py-1.5!`}>
            <Reply aria-hidden="true" className="h-4 w-4" />
            {t("prev.reply")}
          </button>
        )}
      </div>
    </li>
  );
}

function ProviderReviews() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [unanswered, setUnanswered] = useState(false);
  const [data, setData] = useState<{ key: string; reviews: ProviderReview[]; pagination: Pagination | null; error: string }>({
    key: "",
    reviews: [],
    pagination: null,
    error: "",
  });
  const key = `${page}:${unanswered}`;
  const loading = data.key !== key;

  useEffect(() => {
    let cancelled = false;
    listProviderReviews({ page, limit: 10, unanswered })
      .then((result) => {
        if (!cancelled) setData({ key, reviews: result.reviews, pagination: result.pagination, error: "" });
      })
      .catch((error: unknown) => {
        if (!cancelled) setData({ key, reviews: [], pagination: null, error: getErrorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [page, unanswered, key]);

  return (
    <div>
      <PageHeader title={t("nav.reviews")} description={t("prev.subtitle")} />

      <div className="mb-5">
        <SegmentedControl
          label={t("prev.filter")}
          value={unanswered ? "unanswered" : "all"}
          onChange={(value) => {
            setUnanswered(value === "unanswered");
            setPage(1);
          }}
          options={[
            { value: "all", label: t("common.all"), icon: MessageSquare },
            { value: "unanswered", label: t("prev.unanswered"), icon: MessageSquareDashed },
          ]}
        />
      </div>

      {data.error ? <div className={alertError}>{data.error}</div> : null}

      {loading ? (
        <ul className="space-y-4" aria-label={t("prev.loading")}>
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} className={`${card} flex gap-4`}>
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </li>
          ))}
        </ul>
      ) : data.reviews.length === 0 ? (
        <EmptyState icon={unanswered ? MessageSquareCheck : MessageSquare} title={unanswered ? t("prev.allAnswered") : t("vd.noReviews")} />
      ) : (
        <ul className="space-y-4">
          {data.reviews.map((review) => (
            <ReviewItem
              key={review.id}
              review={review}
              onChange={(updated) =>
                setData((current) => ({
                  ...current,
                  reviews: current.reviews.map((r) => (r.id === updated.id ? updated : r)),
                }))
              }
            />
          ))}
        </ul>
      )}

      <Pager pagination={data.pagination} onPageChange={setPage} disabled={loading} />
    </div>
  );
}

export default ProviderReviews;
