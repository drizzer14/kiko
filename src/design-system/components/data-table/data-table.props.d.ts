import type { ReactNode } from 'react';

export type DataTableCell = {
  text: string;
  // "<row>, <month>", from the caller. A header cell is hidden from VoiceOver, so this label
  // carries the column's context.
  accessibilityLabel: string;
  // The FULL amount, never the rounded text shown in the cell.
  accessibilityValue: string;
  tone?: 'negative';
  onPress?: () => void;
  // Only with onPress.
  accessibilityHint?: string;
};

export type DataTableColumn = {
  key: string;
  header: string;
  isSum?: boolean;
};

export type DataTableRow = {
  key: string;
  label: string;
  isSummary?: boolean;
  cells: DataTableCell[];
};

export type DataTableProps = {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  // Drawn above the header inside the vertical scroll, so it scrolls away while the header stays,
  // and the table's summary for VoiceOver.
  caption: string;
  // Drawn above the caption and scrolling away with it, so a large type size leaves the rows
  // the room. The caller owns its spacing within.
  topContent?: ReactNode;
  // Shown under the top content in place of the caption, the header and the rows, filling the room
  // that is left. The top content stays mounted through the swap (a filter sheet open in it stays
  // open), which a caller drawing its own empty state beside the table could not keep.
  emptyContent?: ReactNode;
  // The column whose left edge sits at the fixed column on opening; none means scrolled to the
  // start.
  initialColumnIndex?: number;
  testID?: string;
};
