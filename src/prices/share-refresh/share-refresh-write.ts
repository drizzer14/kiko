import {
  type ShareQuoteCurrencyUpdate,
  setShareQuoteCurrencyDatabaseTransaction,
} from '@kiko/holdings/repo';
import { type PricePointRow, write } from '@kiko/db';
import { updateQuoteQuotaDatabaseTransaction } from '@kiko/settings';

import { settle, type QuotaSettlement } from '../quote-quota';
import { upsertPricePointsDatabaseTransaction } from '../price-points-repo';

export type SharePriceRow = Pick<
  PricePointRow,
  'instrument' | 'day' | 'price' | 'currency' | 'source'
>;

export type ShareRefreshResult = {
  rows: SharePriceRow[];
  units: ShareQuoteCurrencyUpdate[];
  settlement: QuotaSettlement;
};

/**
 * One transaction for everything a refresh learned: the closes, the units it
 * resolved, and the calls it spent, so none of them lands without the others.
 */
export const saveShareRefresh = ({ rows, units, settlement }: ShareRefreshResult): Promise<void> =>
  write(async (databaseTransaction) => {
    await upsertPricePointsDatabaseTransaction(databaseTransaction, rows);

    for (const unit of units) {
      await setShareQuoteCurrencyDatabaseTransaction(databaseTransaction, unit);
    }

    await updateQuoteQuotaDatabaseTransaction(databaseTransaction, (stored) =>
      settle(stored, settlement),
    );
  });
