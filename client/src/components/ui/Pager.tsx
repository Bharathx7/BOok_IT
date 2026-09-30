import type { Pagination } from "../../lib/pagination";
import { btnSecondary } from "../../lib/ui";
import { useI18n } from "../../i18n/useI18n";

type PagerProps = {
  pagination: Pagination | null;
  onPageChange: (page: number) => void;
  disabled?: boolean;
};

function Pager({ pagination, onPageChange, disabled }: PagerProps) {
  const { t } = useI18n();

  if (!pagination || pagination.totalPages <= 1) {
    return null;
  }

  const { page, limit, total, totalPages } = pagination;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="mt-6 flex items-center justify-between gap-4">
      <p className="text-sm text-slate-500">
        {t("pager.showing", { from, to, total })}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={btnSecondary}
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || page <= 1}
        >
          {t("pager.previous")}
        </button>
        <span className="text-sm text-slate-500">
          {t("pager.page", { page, pages: totalPages })}
        </span>
        <button
          type="button"
          className={btnSecondary}
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= totalPages}
        >
          {t("pager.next")}
        </button>
      </div>
    </div>
  );
}

export default Pager;
