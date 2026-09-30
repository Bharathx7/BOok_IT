import { useI18n } from "../../i18n/useI18n";

/** Mark + wordmark. `light` for the navy sidebar and auth panel. */
function Logo({ tone = "dark", showTagline = true }: { tone?: "light" | "dark"; showTagline?: boolean }) {
  const { t } = useI18n();
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 shadow-brand">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
          <path d="m9 14.5 2 2 4-4" />
        </svg>
      </span>
      <span className="leading-tight">
        <span className={`block text-[15px] font-bold tracking-tight ${tone === "light" ? "text-white" : "text-slate-900"}`}>BookIt</span>
        {showTagline ? (
          <span className={`block text-xs font-medium ${tone === "light" ? "text-sidebar-muted" : "text-slate-500"}`}>
            {t("app.tagline")}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export default Logo;
