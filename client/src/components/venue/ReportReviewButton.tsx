import { useState, type FormEvent } from "react";
import { useAuth } from "../../context/useAuth";
import { reportReview } from "../../services/review.api";
import { getErrorMessage } from "../../lib/errors";
import { btnSecondary, input } from "../../lib/ui";
import { useI18n } from "../../i18n/useI18n";

/** "Report" link under a review; signed-in users can tell the admins it breaks the rules. */
function ReportReviewButton({ reviewId }: { reviewId: string }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  if (!user) return null;

  if (state === "done") {
    return <p className="mt-1 text-xs text-slate-500">{t("report.thanks")}</p>;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("sending");
    setError("");
    try {
      await reportReview(reviewId, reason.trim());
      setState("done");
    } catch (err) {
      setError(getErrorMessage(err, t("report.failed")));
      setState("idle");
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1 text-xs font-medium text-slate-400 hover:text-rose-700 hover:underline">
        {t("report.open")}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2">
      <label className="block text-xs font-medium text-slate-600">
        {t("report.question")}
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={3}
          maxLength={500}
          required
          placeholder={t("report.placeholder")}
          className={`${input} mt-1`}
          autoFocus
        />
      </label>
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={state === "sending" || reason.trim().length < 3} className={`${btnSecondary} px-3 py-1.5 text-xs`}>
          {state === "sending" ? t("verify.sending") : t("report.send")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

export default ReportReviewButton;
