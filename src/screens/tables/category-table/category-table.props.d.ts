import type { CalendarMonth } from '@kiko/dates';
import type { Currency } from '@kiko/currency/currency';
import type { RateTable } from '@kiko/rates/conversion';
import type { SpendingLedger } from '@kiko/statistics/spending-ledger';
import type { CategoryDisplay } from '@kiko/categories/category-display';

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
};
