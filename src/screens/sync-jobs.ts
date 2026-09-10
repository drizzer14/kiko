import { isBalanceProviderId } from '../crypto-sync/provider';
import { resyncRequest } from '../crypto-sync/resync-request';
import { runCryptoSync } from '../crypto-sync/run-crypto-sync';
import type { AccountRow } from '../db/schema';
import { runSync } from '../monobank/sync';

/**
 * The fan-out only needs each account's connection marker and a name to report a
 * failure by; both Home's pull-to-refresh (`useSyncAll`) and the app-open
 * auto-sync (`useAutoSync`) pass their full account rows, which satisfy this.
 */
export type SyncableAccount = Pick<AccountRow, 'id' | 'name' | 'institution'>;

/**
 * One account's sync job: its display name (for failure reporting) and the
 * promise-returning run. A connected Monobank account runs with default deps
 * (`runSync({})`); a connected crypto account re-syncs from its stored key
 * (wallet address / Keychain credentials) via `resyncRequest`. A non-syncable
 * (manual) account contributes no job.
 */
export type SyncJob = { name: string; run: () => Promise<unknown> };

/**
 * Build the sync jobs for one account. Shared by the pull-to-refresh fan-out and
 * the app-open auto-sync so both drive EXACTLY the same set — the connected
 * Monobank account plus each connected crypto account — from one place.
 */
export const syncJobsFor = (account: SyncableAccount): SyncJob[] => {
  if (account.institution === 'monobank') {
    return [{ name: account.name, run: () => runSync({}) }];
  }

  // Capture the narrowed institution in a const so it survives into the closure
  // (property narrowing on `account` would not).
  const { institution } = account;
  if (isBalanceProviderId(institution)) {
    return [
      { name: account.name, run: () => runCryptoSync(resyncRequest(institution, account.id)) },
    ];
  }

  return [];
};
