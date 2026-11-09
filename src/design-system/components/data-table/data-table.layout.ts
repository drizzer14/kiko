import type { DataTableColumn, DataTableRow } from './data-table.props';

// The HIG 44pt touch-target floor, as a row's `minHeight`: a tappable cell grows the real layout
// box, because `hitSlop` would reach into the next row.
const MIN_ROW_HEIGHT = 44;

// A cell pads this many `theme.spacing` units on each side of its text.
export const CELL_PADDING_UNITS = 2;

// The widest the fixed first column grows, as a share of the table's measured width.
const FIXED_COLUMN_SHARE = 0.4;

export const labelHeightKey = (rowKey: string) => `label:${rowKey}`;

export const cellHeightKey = (rowKey: string, columnKey: string) => `cell:${rowKey}:${columnKey}`;

// The column's right border is part of its width, so the widest label still fits on one line.
export const resolveFixedWidth = (
  labelWidth: number,
  containerWidth: number,
  padding: number,
  border: number,
) => {
  const natural = labelWidth + padding + border;

  return containerWidth > 0 ? Math.min(natural, containerWidth * FIXED_COLUMN_SHARE) : natural;
};

export const resolveColumnWidths = (
  columns: DataTableColumn[],
  textWidths: Record<string, number>,
  padding: number,
) => columns.map((column) => (textWidths[column.key] ?? 0) + padding);

// Columns that all fit share the room left over evenly, so the grid reaches the right edge;
// columns that overflow, or a room not yet measured, keep their natural widths.
export const fillColumnWidths = (naturalWidths: number[], availableWidth: number) => {
  const slack = availableWidth - naturalWidths.reduce((sum, width) => sum + width, 0);

  if (slack <= 0 || naturalWidths.length === 0) {
    return naturalWidths;
  }

  const share = slack / naturalWidths.length;

  return naturalWidths.map((width) => width + share);
};

// A row is as tall as the taller of its two parts: the fixed label and the tallest scrolled cell.
export const resolveRowHeights = (
  rows: DataTableRow[],
  columns: DataTableColumn[],
  textHeights: Record<string, number>,
  padding: number,
) =>
  Object.fromEntries(
    rows.map((row) => {
      const keys = [
        labelHeightKey(row.key),
        ...columns.map((column) => cellHeightKey(row.key, column.key)),
      ];
      const height = keys.reduce(
        (tallest, key) =>
          textHeights[key] === undefined ? tallest : Math.max(tallest, textHeights[key] + padding),
        MIN_ROW_HEIGHT,
      );

      return [row.key, height];
    }),
  );

// The offset that puts the column's left edge at the fixed column, never past the content's end.
export const resolveInitialOffset = (
  columnWidths: number[],
  columnIndex: number,
  furthestOffset: number,
) => {
  const leading = columnWidths.slice(0, columnIndex).reduce((sum, width) => sum + width, 0);

  return Math.max(0, Math.min(leading, furthestOffset));
};
