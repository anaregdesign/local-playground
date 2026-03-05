/**
 * Tests for desktop updater state helpers.
 */
import { describe, expect, it } from "vitest";
import { resolveDesktopUpdaterActionState } from "~/lib/home/controller/desktop-updater";

describe("resolveDesktopUpdaterActionState", () => {
  it("returns check when no update is available", () => {
    expect(
      resolveDesktopUpdaterActionState({
        updateAvailable: false,
        updateDownloaded: false,
      }),
    ).toBe("check");
  });

  it("returns downloading when update is available but not downloaded", () => {
    expect(
      resolveDesktopUpdaterActionState({
        updateAvailable: true,
        updateDownloaded: false,
      }),
    ).toBe("downloading");
  });

  it("returns upgrade when the update is downloaded", () => {
    expect(
      resolveDesktopUpdaterActionState({
        updateAvailable: false,
        updateDownloaded: true,
      }),
    ).toBe("upgrade");
  });

  it("prioritizes upgrade when both available and downloaded are true", () => {
    expect(
      resolveDesktopUpdaterActionState({
        updateAvailable: true,
        updateDownloaded: true,
      }),
    ).toBe("upgrade");
  });
});
