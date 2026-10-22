import { useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";
export const THEMES: Theme[] = ["light", "dark", "system"];

/** Read by the inline script in index.html too, so dark pages don't flash white on load. */
const THEME_KEY = "openturnly.theme";
const listeners = new Set<() => void>();

function stored(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

let current = stored();

/** Remembers the choice on this device. */
export function setTheme(theme: Theme) {
  current = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private windows may refuse storage; the choice still applies until reload.
  }
  for (const listener of listeners) listener();
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

/**
 * Paints the admin and the sign-in pages in the chosen theme while they're on screen.
 * Booking pages keep the look each business chose, so they never call this.
 */
export function useAppTheme() {
  const theme = useTheme();
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      root.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
    apply();
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
      root.classList.remove("dark");
    };
  }, [theme]);
}
