/**
 * Home runtime support module.
 */
import { HOME_DEFAULT_THEME, HOME_THEME_STORAGE_KEY } from "~/lib/constants";
import type { HomeTheme } from "~/lib/home/shared/view-types";

const HOME_THEME_VALUES = new Set<HomeTheme>(["light", "dark"]);

export function readHomeThemeFromUnknown(value: unknown): HomeTheme | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || !HOME_THEME_VALUES.has(normalized as HomeTheme)) {
    return null;
  }

  return normalized as HomeTheme;
}

export function readHomeThemeFromStorage(storage: Storage | null | undefined): HomeTheme {
  if (!storage) {
    return HOME_DEFAULT_THEME;
  }

  try {
    const storedTheme = storage.getItem(HOME_THEME_STORAGE_KEY);
    return readHomeThemeFromUnknown(storedTheme) ?? HOME_DEFAULT_THEME;
  } catch {
    return HOME_DEFAULT_THEME;
  }
}

export function saveHomeThemeToStorage(
  storage: Storage | null | undefined,
  homeTheme: HomeTheme,
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(HOME_THEME_STORAGE_KEY, homeTheme);
  } catch {
    // Ignore storage write failures and keep runtime state as source of truth.
  }
}
