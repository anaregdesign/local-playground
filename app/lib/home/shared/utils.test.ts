import { afterEach, describe, expect, it, vi } from "vitest";
import { uniqueStringsCaseInsensitive } from "./collections";
import { getFileExtension } from "./files";
import { createId } from "./ids";
import { clampNumber } from "./numbers";

describe("getFileExtension", () => {
  it("extracts lowercase extension from file names", () => {
    expect(getFileExtension("Prompt.JSON")).toBe("json");
    expect(getFileExtension("archive.tar.gz")).toBe("gz");
    expect(getFileExtension("no-extension")).toBe("");
    expect(getFileExtension("trailing-dot.")).toBe("");
  });
});

describe("clampNumber", () => {
  it("clamps values and handles NaN", () => {
    expect(clampNumber(Number.NaN, 1, 10)).toBe(1);
    expect(clampNumber(-1, 1, 10)).toBe(1);
    expect(clampNumber(20, 1, 10)).toBe(10);
    expect(clampNumber(5, 1, 10)).toBe(5);
  });
});

describe("uniqueStringsCaseInsensitive", () => {
  it("deduplicates while preserving first appearance", () => {
    expect(uniqueStringsCaseInsensitive(["API", "api", "Trace", "TRACE", "Api"])).toEqual([
      "API",
      "Trace",
    ]);
  });
});

describe("createId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates prefixed ids", () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    vi.spyOn(Math, "random").mockReturnValue(0.987654321);

    const id = createId("turn");

    expect(id.startsWith("turn-1700000000000-")).toBe(true);
  });
});
