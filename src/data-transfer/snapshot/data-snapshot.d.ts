// src/data-transfer/snapshot/data-snapshot.d.ts
import type {
  AccountRow,
  CategoryOverrideRow,
  CategoryRow,
  CurrencyRateHistoryRow,
  CurrencyRateRow,
  HoldingRow,
  SettingsRow,
  SyncStateRow,
  TransactionRow,
} from '../../db/schema';

/**
 * Every logical table in the app, as a flat row-array snapshot. This is the
 * ONE list every table in `db/schema.ts` must appear in — `read-snapshot.ts`
 * populates it, `restore-snapshot.ts` consumes it, and the encrypted `.kiko`
 * payload (`payload.d.ts`) carries it verbatim.
 */
export type DataSnapshot = {
  accounts: AccountRow[];
  holdings: HoldingRow[];
  transactions: TransactionRow[];
  currencyRates: CurrencyRateRow[];
  currencyRateHistory: CurrencyRateHistoryRow[];
  settings: SettingsRow[];
  syncState: SyncStateRow[];
  categories: CategoryRow[];
  categoryOverrides: CategoryOverrideRow[];
};
