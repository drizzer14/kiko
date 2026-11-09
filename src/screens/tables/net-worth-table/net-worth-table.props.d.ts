import type { ReactNode } from 'react';
import type { CalendarMonth } from '@kiko/dates';
import type { Currency } from '@kiko/currency/currency';
import type { RateTable } from '@kiko/rates/conversion';
import type { PriceBook } from '@kiko/prices/price-book';
import type { BackfillStatus } from '@kiko/rates/history-backfill';
import type { SeriesHolding } from '@kiko/statistics/holding-value-at';
import type { AccountRow, CurrencyRateHistoryRow, HoldingRow, TransactionRow } from '@kiko/db';

export type NetWorthTableProps = {
  /** The accounts the filter shows, in the order the Accounts screen lists them. */
  accounts: readonly AccountRow[];
  /** Closed holdings too: the table values a closed one up to the instant it closed. */
  holdings: readonly (SeriesHolding & Pick<HoldingRow, 'accountId'>)[];
  /** The whole ledger, which rebuilds each holding's balance at a past month end. */
  transactions: readonly Pick<
    TransactionRow,
    'id' | 'holdingId' | 'time' | 'amountMinorUnits' | 'source'
  >[];
  historyRows: Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate'>[];
  /** The period's whole months, oldest first. */
  months: readonly CalendarMonth[];
  now: number;
  /** Today's rates: the last column's, and the rate of a currency with no stored history. */
  rateTable: RateTable;
  priceBook: PriceBook;
  baseCurrency: Currency;
  /** The shared backfill run: a table with no value yet waits on it, one with values shows them. */
  backfillState: BackfillStatus['state'];
  /**
   * The filters and the period. They scroll with the caption above the rows, and stay on screen
   * in the empty and loading states, where they are the way out.
   */
  topContent: ReactNode;
};
