import { useState } from 'react';
import { runLoanAutoLink } from '@kiko/loans/use-loan-auto-link';

import { type SyncableAccount, type SyncJob, syncJobsFor } from '../sync-jobs';
import { settleJobsBesideMarketRefresh } from '../settle-jobs-beside-market-refresh';

type UseSyncAll = {
  /** Names of the accounts whose sync failed on the last run — empty on full success. */
  failures: string[];
  syncAll: () => Promise<void>;
};

/**
 * Run one whole fan-out and refresh rates + metals once, returning the names
 * of the accounts whose job rejected (empty on full success). Only the sync
 * FAN-OUT is gated on having jobs; the refresh is decoupled from it so a
 * manual-only account list (no Monobank/crypto connected) still gets
 * cross-rates cached — mirroring `useAutoSync`'s identical decoupling. Running it
 * unconditionally is safe: `refreshMarketData` is self-throttled (its own
 * `refreshRates` step) and hits only PUBLIC, tokenless endpoints.
 *
 * `refreshMarketData` never rejects (it logs its own failure and returns a
 * Left/Right), so the single-flight lock in `runSyncAllOnce` below still
 * releases only once this whole call settles. The concurrent-refresh and
 * orphan-promise guards (running rates and metals under ONE
 * `Promise.allSettled` rather than sequentially) live in `refreshMarketData`,
 * not here.
 */
const fanOutAndRefresh = async (jobs: SyncJob[]): Promise<string[]> => {
  // One refresh for the whole fan-out (not per account), mirroring the single
  // refresh a lone sync does — `metals` since a pull-to-refresh also needs
  // metal prices, unlike a single Monobank/crypto sync.
  // Results come back in job order, so `results[index]` still aligns to
  // `jobs[index]` for naming the failed accounts.
  const results = await settleJobsBesideMarketRefresh(jobs);

  // One matcher run for the whole fan-out too — any account's sync can bring
  // in a new loan-payment debit. Never rejects (its own doc comment), so a
  // failed auto-link never turns a successful fan-out into a reported one.
  await runLoanAutoLink();

  return jobs.filter((_, index) => results[index].status === 'rejected').map((job) => job.name);
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

    setFailures([]);
    const failed = await runSyncAllOnce(jobs);
    setFailures(failed);
  };

  return { failures, syncAll };
};
