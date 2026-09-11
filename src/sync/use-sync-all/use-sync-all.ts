import { ratesRepo } from '@kiko/rates/rates.repo';
import either from 'fnts/either';
import { useState } from 'react';

import { refreshRates } from '../../rates/rates-refresh';

import { SYNC_CONCURRENCY_LIMIT, settleAllLimited } from '../settle-limited';
import { type SyncableAccount, type SyncJob, syncJobsFor } from '../sync-jobs';

type UseSyncAll = {
  /** Names of the accounts whose sync failed on the last run — empty on full success. */
  failures: string[];
  syncAll: () => Promise<void>;
};

/**
 * Run one whole fan-out and refresh rates once, returning the names of the
 * accounts whose job rejected (empty on full success).
 */
const fanOutAndRefresh = async (jobs: SyncJob[]): Promise<string[]> => {
  // Cap CONCURRENT syncs so a many-connection pull never fires N provider
  // requests at once (device load / provider rate limits). Results come back in
  // job order, so `results[index]` still aligns to `jobs[index]` for naming the
  // failed accounts — see `settleAllLimited`.
  const results = await settleAllLimited(
    jobs.map((job) => job.run),
    SYNC_CONCURRENCY_LIMIT,
  );
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

  return failed;
};

/**
 * A module-level single-flight lock over the WHOLE pull fan-out, mirroring
 * `runSync`'s `inFlightSync` on the Monobank side. A pull-to-refresh (or an
 * app-open auto-sync) that arrives while a fan-out is already in flight JOINS it
 * and observes its result, rather than starting a SECOND fan-out. Without this,
 * a second fan-out re-runs every crypto `runBalanceSync`, and each re-entry
 * re-registers its holdings into the still-open, reference-counted progress
 * session (`src/monobank/sync-status.ts`) — whose accumulators reset only when
 * the session depth returns to 0 — so the "N / M holdings" total grew by the
 * crypto holding count on every pull. The lock releases the instant the run
 * settles (success OR failure), so a later, non-overlapping pull fans out fresh.
 */
let inFlightSyncAll: Promise<string[]> | null = null;

const runSyncAllOnce = (jobs: SyncJob[]): Promise<string[]> => {
  if (inFlightSyncAll) {
    return inFlightSyncAll;
  }
  const run = fanOutAndRefresh(jobs);
  inFlightSyncAll = run;
  const release = (): void => {
    if (inFlightSyncAll === run) {
      inFlightSyncAll = null;
    }
  };
  run.then(release, release);
  return run;
};

/**
 * The Home pull-to-refresh fan-out: sync EVERY syncable account at once — the
 * connected Monobank account plus each connected crypto account — then refresh
 * rates ONCE for the whole batch. The jobs run settled under a bounded worker
 * pool (`settleAllLimited`, cap `SYNC_CONCURRENCY_LIMIT`), so one account's
 * failure never blocks the others (PARTIAL success); the failed
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
    const failed = await runSyncAllOnce(jobs);
    setFailures(failed);
  };

  return { failures, syncAll };
};
