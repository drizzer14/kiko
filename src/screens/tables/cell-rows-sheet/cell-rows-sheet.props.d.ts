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
};
