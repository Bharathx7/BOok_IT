import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

/** "← Somewhere" above a page title, back to the list it came from. */
export default function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="mb-4 inline-flex items-center gap-1.5 py-1 text-sm font-semibold text-slate-600 transition hover:text-brand-700">
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      {children}
    </Link>
  );
}
