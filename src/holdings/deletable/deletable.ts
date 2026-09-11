import { balanceProviderIds } from '../../crypto-sync/provider';
import type { AccountRow, HoldingRow, TransactionRow } from '../../db/schema';
import { syncedMetadataFields } from '../holding-metadata';

/** Every `accounts.institution` value that marks an account as owned by a sync. */
const syncedInstitutions = ['monobank', ...balanceProviderIds] as const;

export type SyncedInstitution = (typeof syncedInstitutions)[number];

/** `manual` is the only source a user writes; every other source is a sync's. */
export const isSyncedTransaction = (row: Pick<TransactionRow, 'source'>): boolean =>
  row.source !== 'manual';

export const isSyncedAccount = (row: Pick<AccountRow, 'institution'>): boolean => {
  return (
    row.institution !== null && (syncedInstitutions as readonly string[]).includes(row.institution)
  );
};

/**
 * Whether a holding's balance is owned by a sync right now. BOTH conditions
 * must hold: its ACCOUNT is currently connected to a synced institution, and
 * the holding itself carries that source's key in metadata.
 *
 * The account gate is load-bearing. `accountsRepo.disconnect` deliberately
 * KEEPS the sync key (`monobankId` / `walletAddress` / `binanceAsset`) on the
 * holding so a later reconnect re-adopts the same row instead of inserting a
 * duplicate that double-counts the balance. The key alone therefore no longer
 * means "synced" — only the key plus a live `institution` does.
 */
export const isSyncedHolding = (
  holding: Pick<HoldingRow, 'metadata'>,
  account: Pick<AccountRow, 'institution'> | undefined,
): boolean => {
  if (account === undefined || !isSyncedAccount(account)) {
    return false;
  }

  const meta = holding.metadata;

  if (typeof meta !== 'object' || meta === null) {
    return false;
  }

  const record = meta as Record<string, unknown>;

  return syncedMetadataFields.some((field) => typeof record[field] === 'string');
};
