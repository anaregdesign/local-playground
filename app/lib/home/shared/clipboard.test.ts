import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./clipboard";

describe("copyTextToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText,
      },
    });

    await copyTextToClipboard("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("throws when clipboard and document APIs are unavailable", async () => {
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal("document", undefined);

    await expect(copyTextToClipboard("hello")).rejects.toThrow(
      "Clipboard API is not available.",
    );
  });
});
