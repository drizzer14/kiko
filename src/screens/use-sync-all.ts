import either from 'fnts/either';
import { useState } from 'react';

import { isBalanceProviderId } from '../crypto-sync/provider';
import { resyncRequest } from '../crypto-sync/resync-request';
import { runCryptoSync } from '../crypto-sync/run-crypto-sync';
import type { AccountRow } from '../db/schema';
import { runSync } from '../monobank/sync';
import { refreshRates } from '../rates/rates-refresh';
import { ratesRepo } from '../repositories/rates.repo';

// The fan-out only needs each account's connection marker and a name to report
// a failure by; Home passes its full account rows, which satisfy this.
type SyncableAccount = Pick<AccountRow, 'id' | 'name' | 'institution'>;

type UseSyncAll = {
  /** Names of the accounts whose sync failed on the last run — empty on full success. */
  failures: string[];
  syncAll: () => Promise<void>;
};

// One account's sync job: its display name (for failure reporting) and the
// promise-returning run. A connected Monobank account runs with default deps
// (`runSync({})`); a connected crypto account re-syncs from its stored key
// (wallet address / Keychain credentials) via `resyncRequest`. A non-syncable
// (manual) account contributes no job.
type SyncJob = { name: string; run: () => Promise<unknown> };

const syncJobsFor = (account: SyncableAccount): SyncJob[] => {
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

/**
 * The Home pull-to-refresh fan-out: sync EVERY syncable account at once — the
 * connected Monobank account plus each connected crypto account — then refresh
 * rates ONCE for the whole batch. The jobs run under `Promise.allSettled`, so
 * one account's failure never blocks the others (PARTIAL success); the failed
 * accounts' names are collected into `failures` for the UI to surface. A pull
 * always forces a fresh sync, bypassing the auto-sync throttle.
 */
export const useSyncAll = (accounts: SyncableAccount[]): UseSyncAll => {
  const [failures, setFailures] = useState<string[]>([]);

  const syncAll = async (): Promise<void> => {
    const jobs = accounts.flatMap(syncJobsFor);
    if (jobs.length === 0) {
      return;
    }

    setFailures([]);

    const results = await Promise.allSettled(jobs.map((job) => job.run()));
    const failed = jobs
      .filter((_, index) => results[index].status === 'rejected')
      .map((job) => job.name);

    // One rate refresh for the whole fan-out (not per account), mirroring the
    // single refresh a lone sync does. Wrapped so a rate-refresh failure — not
    // tied to any one account — never throws out of pull-to-refresh.
    await either(async () => {
      const lastRefreshAt = await ratesRepo.latestFetchedAt();
      await refreshRates({ lastRefreshAt });
    });

    setFailures(failed);
  };

  return { failures, syncAll };
};
