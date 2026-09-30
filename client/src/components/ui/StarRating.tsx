import { Star } from "lucide-react";
import { useI18n } from "../../i18n/useI18n";

/** Five stars, the first `rating` of them filled. Rounds half ratings. */
export function StarRating({ rating, size = 16 }: { rating: number; size?: number }) {
  const { t } = useI18n();
  const filled = Math.round(rating);

  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={t("vd.stars", { rating })}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          aria-hidden="true"
          width={size}
          height={size}
          className={i < filled ? "fill-amber-400 text-amber-400" : "fill-slate-200 text-slate-200"}
        />
      ))}
    </span>
  );
}

/** A single filled star with the venue's rating label beside it. */
export function RatingPill({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 font-semibold text-amber-700 ${className}`}>
      <Star aria-hidden="true" width={14} height={14} className="fill-amber-400 text-amber-400" />
      {label}
    </span>
  );
}
