import type { Currency } from '@kiko/currency/currency';
import type { CellRow } from '@kiko/statistics/cell-rows';

export type CellRowsSheetProps = {
  visible: boolean;
  /** "<row>, <month>": the label of the cell the rows are behind. */
  title: string;
  /** Newest first, as `expenseRowsOf` and `incomeRowsOf` return them. */
  rows: readonly CellRow[];
  /** The currency of the rows' base amounts, which the total is in. */
  baseCurrency: Currency;
  onDismiss: () => void;
  /** A tap on a row: the sheet closes, and its transaction opens once the sheet has closed. */
  onPressRow: (row: CellRow) => void;
  /** The sheet has finished closing, which is when a pressed row's transaction opens. */
  onClosed: () => void;
};
