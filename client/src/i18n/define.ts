/**
 * One area's English strings. English is the full set of keys; use {name}
 * placeholders for values.
 */
export function defineMessages<const E extends Record<string, string>>(en: E) {
  return en;
}

/** Another language's strings for an area: every English key, translated. */
export type Translation<E> = { [K in keyof E]: string };
