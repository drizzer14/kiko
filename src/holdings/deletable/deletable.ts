import { bankProviderIds } from '@kiko/bank-sync/provider';
import { balanceProviderIds } from '@kiko/crypto-sync/provider';
import type { AccountRow, HoldingRow, TransactionRow } from '@kiko/db';

import { syncedMetadataFields } from '../holding-metadata';

/**
 * Every `accounts.institution` value that marks an account as owned by a
 * sync. Driven by the registry's own id lists (`bankProviderIds`,
 * `balanceProviderIds`), never hardcoded, so a provider removed from either
 * registry (Guideline 2.3.1(a) remediation: PrivatBank, bunq, Starling) falls out
 * of this list automatically.
 */
const syncedInstitutions = [...bankProviderIds, ...balanceProviderIds] as const;

export type SyncedInstitution = (typeof syncedInstitutions)[number];

/**
 * `manual` is the only source a user types; every other source is a sync's or a
 * statement file's. A row of any of them is read-only in the form and cannot be
 * duplicated; `isDeletableTransaction` below is the narrower delete gate. A manual row
 * is not always duplicable: one on a holding a sync owns right now is not either
 * (`isSyncedHolding`), which is why each menu tests the row's own holding too.
 */
export const isSyncedTransaction = (row: Pick<TransactionRow, 'source'>): boolean =>
  row.source !== 'manual';

/** A row the user imported from a statement file. */
export const isImportedTransaction = (row: Pick<TransactionRow, 'source'>): boolean =>
  row.source === 'import';

/**
 * A row the user may delete: one they typed, or one they imported from a
 * statement file. A sync owns its own rows, so deleting one would only bring it
 * back on the next fetch.
 */
export const isDeletableTransaction = (row: Pick<TransactionRow, 'source'>): boolean =>
  row.source === 'manual' || isImportedTransaction(row);

export const isSyncedAccount = (row: Pick<AccountRow, 'institution'>): boolean => {
  return (
    row.institution !== null && (syncedInstitutions as readonly string[]).includes(row.institution)
  );
};

/**
 * The message of the error that a write throws when it would add a row to a holding a sync owns
 * right now. A form reads it to tell this refusal from any other failed write.
 */
export const SYNCED_HOLDING_REFUSAL = 'transactions/synced-holding';

/**
 * Whether a holding's metadata carries a sync's key. The key alone does not make the holding
 * synced (`isSyncedHolding`), but a holding with no key never is, so a write reads the account
 * only when this holds.
 */
export const hasSyncedKey = (metadata: unknown): boolean => {
  if (typeof metadata !== 'object' || metadata === null) {
    return false;
  }

  const record = metadata as Record<string, unknown>;

  return syncedMetadataFields.some((field) => typeof record[field] === 'string');
};

/**
 * Whether a holding's balance is owned by a sync right now. BOTH conditions
 * must hold: its ACCOUNT is currently connected to a synced institution, and
 * the holding itself carries that source's key in metadata.
 *
 * The account gate is load-bearing. `accountsRepo.disconnect` deliberately
 * KEEPS the sync key (`monobankId` / `walletAddress` / `binanceAsset`) on the
 * holding so a later reconnect re-adopts the same row instead of inserting a
 * duplicate that double-counts the balance. The key alone therefore does not
 * mean "synced" — only the key plus a live `institution` does.
 */
export const isSyncedHolding = (
  holding: Pick<HoldingRow, 'metadata'>,
  account: Pick<AccountRow, 'institution'> | undefined,
): boolean => {
  if (account === undefined || !isSyncedAccount(account)) {
    return false;
  }

  return hasSyncedKey(holding.metadata);
};

/**
 * The ids of every holding whose account is currently sync-connected: its balance is
 * sync-owned, so it takes no manual write and its rows offer no Duplicate. Shared by every
 * holding picker that must leave one out and by both menus of a row, so the rule cannot drift
 * between them.
 */
export const syncedHoldingIds = (
  holdings: readonly Pick<HoldingRow, 'id' | 'accountId' | 'metadata'>[],
  accountById: ReadonlyMap<string, Pick<AccountRow, 'institution'>>,
): ReadonlySet<string> =>
  new Set(
    holdings
      .filter((candidate) => isSyncedHolding(candidate, accountById.get(candidate.accountId)))
      .map((candidate) => candidate.id),
  );
