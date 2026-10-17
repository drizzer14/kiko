export type GridColumns = 1 | 2 | 3;

// Above every Duo width (its widest pane is 669) and below the narrowest iPad width that gets two
// columns (744, an iPad mini's portrait pane), so a Duo screen never changes. A half pane of a
// landscape 721 to 1099 pt window (360 to 549 pt) stays at one column, as the spec's layout table
// has it.
export const TWO_COLUMN_MIN_WIDTH = 700;

// Room for three cards across: a 13-inch iPad window is 1032 wide, and a 12.9-inch one is 1024 in
// portrait.
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
