import either from 'fnts/either';
import { useState } from 'react';

import { refreshRates } from '../rates/rates-refresh';
import { ratesRepo } from '../repositories/rates.repo';

import { type SyncableAccount, syncJobsFor } from './sync-jobs';

type UseSyncAll = {
  /** Names of the accounts whose sync failed on the last run — empty on full success. */
  failures: string[];
  syncAll: () => Promise<void>;
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
