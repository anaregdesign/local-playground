export const MAIN_SPLITTER_MIN_RIGHT_WIDTH_PX = 320;
export const MAIN_SPLITTER_MIN_LEFT_WIDTH_PX = 560;

export function resolveMainSplitterMaxRightWidth(totalWidthPx: number): number {
  return Math.max(MAIN_SPLITTER_MIN_RIGHT_WIDTH_PX, totalWidthPx - MAIN_SPLITTER_MIN_LEFT_WIDTH_PX);
}
