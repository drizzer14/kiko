export type GridColumns = 1 | 2 | 3;

// Above every Duo width (its widest pane is 669) and below the narrowest iPad pane (744), so a
// Duo screen never changes and an iPad pane always gets a second column.
export const TWO_COLUMN_MIN_WIDTH = 700;

// A 13-inch iPad window is 1032 wide, the one width that has room for three cards across.
export const THREE_COLUMN_MIN_WIDTH = 1000;

/**
 * How many cards sit side by side in a content area `width` points wide. The width is the pane's
 * own, or the window's where no pane applies.
 */
export const resolveGridColumns = (width: number): GridColumns => {
  if (width >= THREE_COLUMN_MIN_WIDTH) {
    return 3;
  }

  if (width >= TWO_COLUMN_MIN_WIDTH) {
    return 2;
  }

  return 1;
};

/**
 * Splits `items` into rows of `columns` cells. A short last row is padded with `null`, a spacer
 * that keeps its cards the width of a full row's.
 */
export const toGridRows = <Item>(items: readonly Item[], columns: GridColumns): (Item | null)[][] =>
  Array.from({ length: Math.ceil(items.length / columns) }, (_row, rowIndex) =>
    Array.from(
      { length: columns },
      (_cell, columnIndex) => items[rowIndex * columns + columnIndex] ?? null,
    ),
  );
