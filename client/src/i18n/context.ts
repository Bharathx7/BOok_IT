import { createContext } from "react";
import type { MessageKey } from "./en";

export const LANGUAGES = [
  { code: "en", label: "English", locale: "en-IN" },
  { code: "hi", label: "हिन्दी", locale: "hi-IN" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

export interface I18n {
  /** The language on screen. */
  language: Language;
  /** The language picked; differs from `language` while its strings download. */
  chosen: Language;
  /** BCP 47 locale for Intl date/number formatting. */
  locale: string;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18n | null>(null);
