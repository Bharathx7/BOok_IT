import { LANGUAGES, type Language } from "./context";
import { useI18n } from "./useI18n";

function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { chosen, setLanguage, t } = useI18n();

  return (
    <select
      value={chosen}
      onChange={(event) => setLanguage(event.target.value as Language)}
      aria-label={t("language.label")}
      className={`rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 ${className}`}
    >
      {LANGUAGES.map((option) => (
        <option key={option.code} value={option.code}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export default LanguageSwitcher;
