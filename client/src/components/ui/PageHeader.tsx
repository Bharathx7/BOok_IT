import type { ReactNode } from "react";
import { pageSub, pageTitle } from "../../lib/ui";

type PageHeaderProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Small label above the title, e.g. a section name. */
  eyebrow?: string;
};

function PageHeader({ title, description, action, eyebrow }: PageHeaderProps) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-brand-600">{eyebrow}</p> : null}
        <h1 className={pageTitle}>{title}</h1>
        {description ? <p className={pageSub}>{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export default PageHeader;
