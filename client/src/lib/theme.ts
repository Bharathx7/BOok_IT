export type ThemePreference = "system" | "light" | "dark";

const KEY = "bookit-theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Puts the .dark class on <html> for the given preference. */
export function applyTheme(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b1020" : "#4f46e5");
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, preference);
  } catch {
    // Private mode: the choice lasts until the tab closes.
  }
  applyTheme(preference);
}

/** Follows the operating system while the preference is "system". */
export function watchSystemTheme() {
  const listener = () => {
    if (getThemePreference() === "system") applyTheme("system");
  };
  media().addEventListener("change", listener);
  return () => media().removeEventListener("change", listener);
}
