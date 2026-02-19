import {
  HOME_MAIN_SPLITTER_MIN_LEFT_WIDTH_PX,
  HOME_MAIN_SPLITTER_MIN_RIGHT_WIDTH_PX,
} from "~/lib/constants";

export function resolveMainSplitterMaxRightWidth(totalWidthPx: number): number {
  return Math.max(HOME_MAIN_SPLITTER_MIN_RIGHT_WIDTH_PX, totalWidthPx - HOME_MAIN_SPLITTER_MIN_LEFT_WIDTH_PX);
}
