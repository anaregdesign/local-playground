import { describe, expect, it } from "vitest";
import {
  HOME_MAIN_SPLITTER_MIN_LEFT_WIDTH_PX,
  HOME_MAIN_SPLITTER_MIN_RIGHT_WIDTH_PX,
} from "~/lib/constants";
import { resolveMainSplitterMaxRightWidth } from "./main-splitter";

describe("resolveMainSplitterMaxRightWidth", () => {
  it("keeps right pane at least the configured minimum", () => {
    const tinyWidth = HOME_MAIN_SPLITTER_MIN_LEFT_WIDTH_PX - 100;
    expect(resolveMainSplitterMaxRightWidth(tinyWidth)).toBe(
      HOME_MAIN_SPLITTER_MIN_RIGHT_WIDTH_PX,
    );
  });

  it("uses remaining width when larger than right minimum", () => {
    const totalWidth =
      HOME_MAIN_SPLITTER_MIN_LEFT_WIDTH_PX + HOME_MAIN_SPLITTER_MIN_RIGHT_WIDTH_PX + 200;

    expect(resolveMainSplitterMaxRightWidth(totalWidth)).toBe(
      totalWidth - HOME_MAIN_SPLITTER_MIN_LEFT_WIDTH_PX,
    );
  });
});
