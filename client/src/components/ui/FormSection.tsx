import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { card } from "../../lib/ui";

type Props = {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Controls on the right of the heading, e.g. a switch. */
  aside?: ReactNode;
  children?: ReactNode;
};

/** A card in a long form: an icon, a title and what the section is for. */
export default function FormSection({ icon: Icon, title, description, aside, children }: Props) {
  return (
    <section className={card}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
          </div>
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
      {children ? <div className="mt-5 space-y-5">{children}</div> : null}
    </section>
  );
}
