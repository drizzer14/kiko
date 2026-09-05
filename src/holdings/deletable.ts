import { balanceProviderIds } from '../crypto-sync/provider';
import type { AccountRow, HoldingRow, TransactionRow } from '../db/schema';

import { syncedMetadataFields } from './holding-metadata';

/** Every `accounts.institution` value that marks an account as owned by a sync. */
const syncedInstitutions = ['monobank', ...balanceProviderIds] as const;

export type SyncedInstitution = (typeof syncedInstitutions)[number];

/** `manual` is the only source a user writes; every other source is a sync's. */
export const isSyncedTransaction = (row: Pick<TransactionRow, 'source'>): boolean =>
  row.source !== 'manual';

export const isSyncedHolding = (row: Pick<HoldingRow, 'metadata'>): boolean => {
  const meta = row.metadata;

  if (typeof meta !== 'object' || meta === null) {
    return false;
  }

  const record = meta as Record<string, unknown>;

  return syncedMetadataFields.some((field) => typeof record[field] === 'string');
};

export const isSyncedAccount = (row: Pick<AccountRow, 'institution'>): boolean => {
  return (
    row.institution !== null && (syncedInstitutions as readonly string[]).includes(row.institution)
  );
};
