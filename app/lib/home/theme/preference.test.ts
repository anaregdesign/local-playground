/**
 * Test module verifying Home theme preference parsing and storage behavior.
 */
import { describe, expect, it } from "vitest";
import { HOME_DEFAULT_THEME } from "~/lib/constants";
import {
  readHomeThemeFromStorage,
  readHomeThemeFromUnknown,
  saveHomeThemeToStorage,
} from "~/lib/home/theme/preference";

describe("readHomeThemeFromUnknown", () => {
  it("accepts light and dark values", () => {
    expect(readHomeThemeFromUnknown("light")).toBe("light");
    expect(readHomeThemeFromUnknown("dark")).toBe("dark");
    expect(readHomeThemeFromUnknown(" DARK ")).toBe("dark");
  });

  it("returns null for unsupported values", () => {
    expect(readHomeThemeFromUnknown("system")).toBeNull();
    expect(readHomeThemeFromUnknown(42)).toBeNull();
  });
});

describe("readHomeThemeFromStorage", () => {
  it("returns default when storage is unavailable", () => {
    expect(readHomeThemeFromStorage(null)).toBe(HOME_DEFAULT_THEME);
  });

  it("reads and normalizes stored theme", () => {
    const storage = createStorageMock({ "local-playground:home-theme": " DARK " });
    expect(readHomeThemeFromStorage(storage)).toBe("dark");
  });

  it("returns default when storage throws", () => {
    const storage = createStorageMock({ "local-playground:home-theme": "dark" }, true);
    expect(readHomeThemeFromStorage(storage)).toBe(HOME_DEFAULT_THEME);
  });
});

describe("saveHomeThemeToStorage", () => {
  it("writes theme when storage is available", () => {
    const storage = createStorageMock();
    saveHomeThemeToStorage(storage, "dark");
    expect(storage.getItem("local-playground:home-theme")).toBe("dark");
  });

  it("ignores storage write errors", () => {
    const storage = createStorageMock({}, false, true);
    expect(() => saveHomeThemeToStorage(storage, "dark")).not.toThrow();
  });
});

function createStorageMock(
  initial: Record<string, string> = {},
  throwOnRead = false,
  throwOnWrite = false,
): Storage {
  const data = new Map<string, string>(Object.entries(initial));

  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      if (throwOnRead) {
        throw new Error("read failed");
      }
      return data.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      if (throwOnWrite) {
        throw new Error("write failed");
      }
      data.set(key, value);
    },
  };
}
