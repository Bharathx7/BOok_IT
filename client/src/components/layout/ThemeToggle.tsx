import { useEffect, useState } from "react";
import { getThemePreference, setThemePreference, watchSystemTheme, type ThemePreference } from "../../lib/theme";
import { useI18n } from "../../i18n/useI18n";

const NEXT: Record<ThemePreference, ThemePreference> = { system: "light", light: "dark", dark: "system" };

function Icon({ theme }: { theme: ThemePreference }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (theme === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

/** Cycles device → light → dark. */
function ThemeToggle() {
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const { t } = useI18n();
  const label = t(`theme.${theme}`);

  useEffect(() => watchSystemTheme(), []);

  return (
    <button
      type="button"
      onClick={() => {
        const next = NEXT[theme];
        setThemePreference(next);
        setTheme(next);
      }}
      title={label}
      aria-label={t("theme.switchTo", { current: label, next: t(`theme.next.${NEXT[theme]}`) })}
      className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:text-brand-700"
    >
      <Icon theme={theme} />
    </button>
  );
}

export default ThemeToggle;
