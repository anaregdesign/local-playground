/**
 * Home runtime support module.
 */
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
