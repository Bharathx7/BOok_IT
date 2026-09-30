import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

const TONES = {
  brand: "bg-brand-50 text-brand-600",
  green: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  sky: "bg-sky-50 text-sky-600",
  rose: "bg-rose-50 text-rose-600",
} as const;

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  hint?: string;
  loading?: boolean;
  /** Makes the whole card a link, e.g. to the list behind the number. */
  to?: string;
}

/** A headline number with an icon, for dashboards. */
function StatCard({ label, value, icon: Icon, tone = "brand", hint, loading, to }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`}>
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      </div>
      {loading ? (
        <div className="mt-2 h-8 w-20 animate-pulse rounded-md bg-slate-100" aria-hidden />
      ) : (
        <p className="tabular mt-1 text-[1.75rem] font-bold tracking-tight text-slate-900">{value}</p>
      )}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </>
  );
  const frame = "block rounded-xl border border-slate-200 bg-white p-5 shadow-card";

  return to ? (
    <Link to={to} className={`${frame} transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-raised`}>
      {body}
    </Link>
  ) : (
    <div className={frame}>{body}</div>
  );
}

export default StatCard;
