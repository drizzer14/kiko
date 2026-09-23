import type { TableCell } from '../../../statement-import/column-mapping';

export type RawPreviewProps = {
  rows: TableCell[][];
  // `undefined` before the header row has been guessed/applied yet — no row
  // reads as selected in that state.
  headerRowIndex: number | undefined;
  onSelectHeaderRow: (rowIndex: number) => void;
  testID?: string;
};
