import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { ratesRepo } from '@kiko/rates/rates.repo';
import { syncStateRepo } from '@kiko/sync-state/sync-state.repo';
import either from 'fnts/either';
import { useEffect, useRef } from 'react';

import { hasToken } from '../monobank/token';
import { refreshRates } from '../rates/rates-refresh';

import { SYNC_CONCURRENCY_LIMIT, settleAllLimited } from './settle-limited';
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
 * within the window (or never has). The cursor now lives PER CONNECTION in
 * `sync_state` (de-globalized from `settings` — see the `syncState` table
 * comment in `db/schema.ts`), so the throttle reads the connected Monobank
 * account's own cursor; a crypto-only user (no Monobank account) has none, so
 * the throttle lets every launch sync once (the per-mount `hasRun` ref still
 * fires it at most once per app open).
 */
export const throttleElapsed = (lastSyncAt: number | null, now: number): boolean =>
  lastSyncAt === null || now - lastSyncAt >= AUTO_SYNC_INTERVAL_MS;

/**
 * Runs one throttled background sync when the app opens, fanning out over EVERY
 * connected account — the Monobank account (when a token is stored) PLUS each
 * connected crypto account — exactly the set the pull-to-refresh fan-out
 * (`useSyncAll`) drives, so a crypto balance + Binance transaction import happens
 * on open, not only on pull. The jobs run settled under a bounded worker pool
 * (`settleAllLimited`, cap `SYNC_CONCURRENCY_LIMIT`), so one account's failure
 * never blocks the others and a many-connection fan-out never fires every
 * provider request at once; rates refresh once for the batch.
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
      const connectedAccounts = await accountsRepo.connectedQuery();
      // The throttle reads the connected Monobank account's OWN cursor from
      // `sync_state`; a crypto-only user has no Monobank account, so `null` lets
      // the launch sync once.
      const monobankAccountId = connectedAccounts.find(
        (account) => account.institution === 'monobank',
      )?.id;
      const syncStateRows =
        monobankAccountId === undefined ? [] : await syncStateRepo.getQuery(monobankAccountId);
      const lastSyncAt = syncStateRows.at(0)?.lastSyncAt ?? null;

      if (!throttleElapsed(lastSyncAt, Date.now())) {
        return;
      }

      // The token is now PER ACCOUNT, so the Monobank gate probes EACH connected
      // Monobank account's OWN item (`hasToken(account.id)`) independently — not a
      // shared global one. A tokenless Monobank job would only throw, so that
      // account is dropped while every OTHER tokened Monobank account still syncs;
      // crypto accounts need no token. The probe is per account, so the gate is
      // async — `Promise.all` over the connected set. `syncJobsFor` is the same
      // builder pull-to-refresh uses.
      const jobLists = await Promise.all(
        connectedAccounts.map(async (account) => {
          if (account.institution === 'monobank' && !(await hasToken(account.id))) {
            return [];
          }

          return syncJobsFor(account);
        }),
      );
      const jobs = jobLists.flat();

      if (jobs.length === 0) {
        return;
      }

      // Cap CONCURRENT syncs so a many-connection fan-out never fires N provider
      // requests at once (device load / provider rate limits) — see `settleAllLimited`.
      await settleAllLimited(
        jobs.map((job) => job.run),
        SYNC_CONCURRENCY_LIMIT,
      );
      const lastRefreshAt = await ratesRepo.latestFetchedAt();
      await refreshRates({ lastRefreshAt });
    });
  }, []);
};
