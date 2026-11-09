import type { ReactNode } from 'react';
import type { CalendarMonth } from '@kiko/dates';
import type { Currency } from '@kiko/currency/currency';
import type { RateTable } from '@kiko/rates/conversion';
import type { RowDescriber } from '@kiko/statistics/cell-rows';
import type { SpendingLedger } from '@kiko/statistics/spending-ledger';
import type { CategoryDisplay } from '@kiko/categories/category-display';
import type { DataTableProps } from '@kiko/design-system/components/data-table';

export type CategoryTableProps = {
  /** The shared spending ledger the donut is drawn from. */
  ledger: SpendingLedger;
  /** The period's whole months, oldest first. */
  months: readonly CalendarMonth[];
  now: number;
  categoryDisplay: ReadonlyMap<string, CategoryDisplay>;
  rateTable: RateTable;
  baseCurrency: Currency;
  defaultCategoryKey: string;
  /** Category keys a held pick leaves out; empty means every category. */
  excludedCategories: ReadonlySet<string>;
  /** The label of a row in the list a cell opens, as Home labels it. */
  describeRow: RowDescriber;
  /** The screen's count of times it stopped showing; a sheet opened before the last one closes. */
  sheetGeneration: number;
  /** A row of the list a cell opens was pressed and the list has closed: open its transaction. */
  onOpenTransaction: (transactionId: string) => void;
  /**
   * The filters and the period. They scroll with the caption above the rows, and stay on screen
   * in the empty state, where they are the way out of an empty period.
   */
  topContent: ReactNode;
  /** The live height of the bar the table scrolls under, handed to the table as it is. */
  barInset?: DataTableProps['barInset'];
};
