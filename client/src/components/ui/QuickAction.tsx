import { Link } from "react-router-dom";
import { ArrowUpRight, type LucideIcon } from "lucide-react";

/** A shortcut card: icon, title and one line of explanation. */
function QuickAction({ to, icon: Icon, title, hint }: { to: string; icon: LucideIcon; title: string; hint: string }) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-raised"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-900">
          {title}
          <ArrowUpRight className="h-4 w-4 text-slate-400 transition group-hover:text-brand-600" aria-hidden />
        </span>
        <span className="mt-1 block text-sm leading-6 text-slate-500">{hint}</span>
      </span>
    </Link>
  );
}

export default QuickAction;
