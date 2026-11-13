import type { Currency } from '@kiko/currency/currency';
import type { CellRow } from '@kiko/statistics/cell-rows';
import type { CategoryDisplay } from '@kiko/categories/category-display';

export type CellRowsSheetProps = {
  visible: boolean;
  /** "<row>, <month>": the label of the cell the rows are behind. */
  title: string;
  /** Newest first, as `expenseRowsOf` and `incomeRowsOf` return them. */
  rows: readonly CellRow[];
  /** The currency of the rows' base amounts, which the total is in. */
  baseCurrency: Currency;
  /** What each row's category icon, title and colour come from, as Home's rows read them. */
  categoryDisplay: ReadonlyMap<string, CategoryDisplay>;
  /** The category a row with none, or with an unknown one, is shown under. */
  defaultCategoryKey: string;
  onDismiss: () => void;
  /** A tap on a row: the sheet closes, and its transaction opens once the sheet has closed. */
  onPressRow: (row: CellRow) => void;
  /** The sheet has finished closing, which is when a pressed row's transaction opens. */
  onClosed: () => void;
};
