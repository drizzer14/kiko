import type { TableCell } from '../../../statement-import/column-mapping';

// A rough per-character width (points) at the raw-preview grid's caption type
// step, plus the cell's own horizontal padding — good enough for a MONOSPACE-
// ish alignment estimate; this never needs to be pixel-exact, only stable
// per column so every row's Nth cell lines up under the one above it.
const CHAR_WIDTH = 7;
const CELL_HORIZONTAL_PADDING = 16;
const MIN_CELL_WIDTH = 64;
const MAX_CELL_WIDTH = 220;

/**
 * One consistent width PER COLUMN across every previewed row (device-
 * feedback-round-F1, item 6) — the raw preview used to give every cell the
 * SAME fixed `minWidth`, which does not actually align a table: a longer
 * value in one row's date column, say, never widened that same column in
 * every OTHER row, since each row only ever measured its own cells. This
 * computes column index -> width from the LONGEST cell text seen in that
 * column across `rows`, clamped to a sane visible range, so every column
 * reads as a real aligned table column while the whole grid still scrolls
 * horizontally (`RawPreview`'s own `ScrollView`).
 */
export const computeColumnWidths = (rows: TableCell[][]): number[] => {
  const widths: number[] = [];

  for (const row of rows) {
    row.forEach((cell, columnIndex) => {
      const width = Math.min(
        MAX_CELL_WIDTH,
        Math.max(MIN_CELL_WIDTH, String(cell).length * CHAR_WIDTH + CELL_HORIZONTAL_PADDING),
      );
      widths[columnIndex] = Math.max(widths[columnIndex] ?? 0, width);
    });
  }

  return widths;
};
