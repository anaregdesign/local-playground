/**
 * Test module verifying Home theme preference parsing behavior.
 */
import { describe, expect, it } from "vitest";
import { readHomeThemeFromUnknown } from "~/lib/home/theme/preference";

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
