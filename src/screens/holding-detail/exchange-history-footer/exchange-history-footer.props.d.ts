import type { AccountRow, HoldingRow } from '@kiko/db';
import type { SeriesTransaction } from '@kiko/statistics/holding-value-at';

export type ExchangeHistoryFooterProps = {
  holding: Pick<HoldingRow, 'currency' | 'balanceMinorUnits' | 'metadata'>;
  // Undefined until the holding's account loads.
  account: Pick<AccountRow, 'institution'> | undefined;
  // Every row of the holding, as the ledger lists them; the line counts the ones its balance holds.
  transactions: readonly SeriesTransaction[];
};
