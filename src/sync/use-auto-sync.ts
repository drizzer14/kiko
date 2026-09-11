import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { ratesRepo } from '@kiko/rates/rates.repo';
import { settingsRepo } from '@kiko/settings/settings.repo';
import either from 'fnts/either';
import { useEffect, useRef } from 'react';

import { readToken } from '../monobank/token';
import { refreshRates } from '../rates/rates-refresh';

import { syncJobsFor } from './sync-jobs';

/**
 * Throttle window for the automatic on-open sync. Matches the rates cache
 * window in `rates-refresh.ts` (Monobank's `/bank/currency` is itself cached
 * upstream ~5 minutes), so an auto-sync never fires more often than the rate
 * data it also refreshes could usefully change.
 */
export const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The time throttle for the on-open sync: sync only when nothing has synced
 * within the window (or never has). `settings.lastSyncAt` is the shared cursor;
 * a crypto-only user has none, so the throttle lets every launch sync once (the
 * per-mount `hasRun` ref still fires it at most once per app open).
 */
export const throttleElapsed = (lastSyncAt: number | null, now: number): boolean =>
  lastSyncAt === null || now - lastSyncAt >= AUTO_SYNC_INTERVAL_MS;

/**
 * Runs one throttled background sync when the app opens, fanning out over EVERY
 * connected account — the Monobank account (when a token is stored) PLUS each
 * connected crypto account — exactly the set the pull-to-refresh fan-out
 * (`useSyncAll`) drives, so a crypto balance + Binance transaction import happens
 * on open, not only on pull. The jobs run under `Promise.allSettled`, so one
 * account's failure never blocks the others; rates refresh once for the batch.
 *
 * A one-shot read (not `useLiveQuery`) drives the throttle decision, mirroring
 * how `sync.ts` reads settings directly, so this never re-fires as data changes
 * underneath it. Any failure — reading the gating data or refreshing rates — is
 * swallowed: this hook has no UI and must never crash the app on a background
 * sync it did not ask the user about. It never touches the pull-to-refresh
 * spinner signal (`fastPhaseDone` is read only inside the pull handler), so an
 * auto-sync-on-open drives only the determinate progress bar, never the spinner.
 */
export const useAutoSync = (): void => {
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) {
      return;
    }
    hasRun.current = true;

    either<unknown, void>(async () => {
      const [connectedAccounts, settingsRows, token] = await Promise.all([
        accountsRepo.connectedQuery(),
        settingsRepo.getQuery(),
        readToken(),
      ]);
      const lastSyncAt = settingsRows.at(0)?.lastSyncAt ?? null;

      if (!throttleElapsed(lastSyncAt, Date.now())) {
        return;
      }

      const hasToken = token !== undefined;
      // Build the fan-out: every connected crypto account, plus the Monobank
      // account when a token is stored (a tokenless Monobank job would only
      // throw). `syncJobsFor` is the same builder pull-to-refresh uses.
      const jobs = connectedAccounts.flatMap((account) =>
        account.institution === 'monobank' && !hasToken ? [] : syncJobsFor(account),
      );

      if (jobs.length === 0) {
        return;
      }

      await Promise.allSettled(jobs.map((job) => job.run()));
      const lastRefreshAt = await ratesRepo.latestFetchedAt();
      await refreshRates({ lastRefreshAt });
    });
  }, []);
};
