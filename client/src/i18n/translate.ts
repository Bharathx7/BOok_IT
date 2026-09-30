import { en, type MessageKey } from "./en";
import { LANGUAGES, type Language } from "./context";

export type MessageValues = Record<string, string | number>;

// English ships with the app; other languages are fetched when first chosen.
const dictionaries: Partial<Record<Language, Record<MessageKey, string>>> = { en };

const loaders: Record<Exclude<Language, "en">, () => Promise<Record<MessageKey, string>>> = {
  hi: () => import("./messages/hi").then((module) => module.hi),
};

/** Downloads a language's strings (once). Resolves when they can be used. */
export async function loadLanguage(language: Language) {
  if (dictionaries[language]) return;
  dictionaries[language] = await loaders[language as Exclude<Language, "en">]();
}

export const isLanguageLoaded = (language: Language) => Boolean(dictionaries[language]);

// The current language, for code outside React (error messages, date
// formatting). I18nProvider keeps it in sync.
let current: Language = "en";

export const currentLanguage = () => current;
export const currentLocale = () => LANGUAGES.find((l) => l.code === current)!.locale;

export function setCurrentLanguage(language: Language) {
  current = language;
}

/** A message in the given language, falling back to English while it loads. */
export function translate(key: MessageKey, values?: MessageValues, language: Language = current) {
  const template = dictionaries[language]?.[key] ?? en[key] ?? key;
  return values
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match))
    : template;
}

/**
 * For keys built from data (a sport, an amenity, an enum value): the
 * translation when there is one, otherwise the fallback.
 */
export function translateOr(key: string, fallback: string, language: Language = current) {
  return key in en ? translate(key as MessageKey, undefined, language) : fallback;
}
