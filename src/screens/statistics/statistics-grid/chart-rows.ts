// Each card needs the pie legend's fixed columns (192 pt: value, percent, swatch and their gaps),
// about 80 pt for the name label and the card padding. Two cards plus the row gap and the screen
// padding come to 656 pt; a narrower pane leaves a name no room in the legend.
export const SHARED_ROW_MIN_PANE_WIDTH = 656;

/**
 * Whether Expenses by category and Account contribution share one row. Only a large window with a
 * cards pane wide enough for two cards does; every other window stacks every chart full width.
 */
export const isChartRowShared = (isLargeWindow: boolean, paneWidth: number | null): boolean =>
  isLargeWindow && paneWidth !== null && paneWidth >= SHARED_ROW_MIN_PANE_WIDTH;
