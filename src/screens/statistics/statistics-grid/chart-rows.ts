// Two cards across need about 232 pt each with the gap and the padding. The user's simulator look
// decides the final number.
export const SHARED_ROW_MIN_PANE_WIDTH = 480;

/**
 * Whether Expenses by category and Account contribution share one row. Only a large window with a
 * cards pane wide enough for two cards does; every other window stacks every chart full width.
 */
export const isChartRowShared = (isLargeWindow: boolean, paneWidth: number | null): boolean =>
  isLargeWindow && paneWidth !== null && paneWidth >= SHARED_ROW_MIN_PANE_WIDTH;
