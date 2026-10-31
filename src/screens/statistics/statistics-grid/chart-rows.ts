// Each card needs the pie legend's fixed columns (192 pt: value, percent, swatch and their gaps),
// about 80 pt for the name label and the card padding. Two cards plus the row gap and the screen
// padding come to 656 pt; narrower content leaves a name no room in the legend. It is compared
// with the content width (the pane's width limited by the content cap), not the pane's width.
export const SHARED_ROW_MINIMUM_CONTENT_WIDTH = 656;

/**
 * Whether Expenses by category and Account contribution share one row. Only a large window whose
 * cards have room for two cards does (`contentWidth`: the pane's width limited by the content cap,
 * so a capped pane never counts the width the cap takes away); every other window stacks every
 * chart full width.
 */
export const isChartRowShared = (isLargeWindow: boolean, contentWidth: number | null): boolean =>
  isLargeWindow && contentWidth !== null && contentWidth >= SHARED_ROW_MINIMUM_CONTENT_WIDTH;
