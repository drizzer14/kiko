import {
  type ShareQuoteCurrencyUpdate,
  setShareQuoteCurrencyDatabaseTransaction,
} from '@kiko/holdings/repo';
import { writeQuoteQuota } from '@kiko/settings';
import { type PricePointRow, write } from '@kiko/db';

import type { QuoteQuota } from '../quote-quota';
import { upsertPricePointsDatabaseTransaction } from '../price-points-repo';

export type SharePriceRow = Pick<
  PricePointRow,
  'instrument' | 'day' | 'price' | 'currency' | 'source'
>;

export type ShareRefreshResult = {
  rows: SharePriceRow[];
  units: ShareQuoteCurrencyUpdate[];
  quota: QuoteQuota;
};

/**
 * One transaction for everything a refresh learned: the closes, the units it
 * resolved, and the calls it spent, so none of them lands without the others.
 */
export const saveShareRefresh = ({ rows, units, quota }: ShareRefreshResult): Promise<void> =>
  write(async (databaseTransaction) => {
    await upsertPricePointsDatabaseTransaction(databaseTransaction, rows);

    for (const unit of units) {
      await setShareQuoteCurrencyDatabaseTransaction(databaseTransaction, unit);
    }

    await writeQuoteQuota(databaseTransaction, quota);
  });
