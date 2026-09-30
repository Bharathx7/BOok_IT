import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { card } from "../../lib/ui";

type Props = {
  icon: LucideIcon;
  title: string;
  hint?: string;
  /** A button or link that gets the user out of the empty state. */
  action?: ReactNode;
  /** Drop the card frame, e.g. inside a table cell or an existing card. */
  bare?: boolean;
};

/** What a list shows when there is nothing in it: an icon, a line of text, and a way forward. */
export default function EmptyState({ icon: Icon, title, hint, action, bare = false }: Props) {
  return (
    <div className={`${bare ? "" : card} flex flex-col items-center px-6 py-10 text-center`}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Icon aria-hidden="true" className="h-6 w-6" />
      </span>
      <p className="mt-4 font-semibold text-slate-900">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">{hint}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
