import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MessageKey } from "./en";
import { I18nContext, LANGUAGES, type Language } from "./context";
import { isLanguageLoaded, loadLanguage, setCurrentLanguage, translate, type MessageValues } from "./translate";

const KEY = "bookit-language";

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "hi") return saved;
  } catch {
    // Storage blocked: fall through.
  }
  return navigator.language?.toLowerCase().startsWith("hi") ? "hi" : "en";
}

/**
 * Holds the chosen language; strings come from ./messages. A language other
 * than English is shown once its strings have downloaded (English until then).
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [chosen, setChosen] = useState<Language>(initialLanguage);
  // The language on screen: `chosen` once its strings are loaded.
  const [language, setLanguageState] = useState<Language>(() => (isLanguageLoaded(chosen) ? chosen : "en"));

  useEffect(() => {
    let cancelled = false;
    loadLanguage(chosen)
      .then(() => {
        if (cancelled) return;
        setCurrentLanguage(chosen);
        setLanguageState(chosen);
      })
      .catch(() => {
        // Offline or a failed download: stay in the current language.
      });
    return () => {
      cancelled = true;
    };
  }, [chosen]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setChosen(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode: lasts until the tab closes.
    }
  }, []);

  const t = useCallback(
    (key: MessageKey, values?: MessageValues) => translate(key, values, language),
    [language]
  );

  const value = useMemo(
    () => ({
      language,
      locale: LANGUAGES.find((l) => l.code === language)!.locale,
      // The switcher shows the choice straight away, even while it loads.
      chosen,
      setLanguage,
      t,
    }),
    [language, chosen, setLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
