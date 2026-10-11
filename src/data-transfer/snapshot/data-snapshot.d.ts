// src/data-transfer/snapshot/data-snapshot.d.ts
import type {
  AccountRow,
  BondRegisterRow,
  CategoryOverrideRow,
  CategoryRow,
  CurrencyRateHistoryRow,
  CurrencyRateRow,
  DeletedImportKeyRow,
  HoldingRow,
  PricePointRow,
  ReminderRow,
  SettingsRow,
  SyncStateRow,
  TransactionRow,
  TransactionTemplateRow,
} from '@kiko/db';

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
  pricePoints: PricePointRow[];
  bondRegister: BondRegisterRow[];
  reminders: ReminderRow[];
  // Optional, unlike the tables above: an older file never had the key, and a
  // restore reads it defensively (`restoreDataSnapshot`) without a version bump.
  deletedImportKeys?: DeletedImportKeyRow[];
  transactionTemplates?: TransactionTemplateRow[];
};
