import { useEffect, useRef } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import either, { bifold, isLeft } from 'fnts/either';
import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { runLoanAutoLink } from '@kiko/loans/use-loan-auto-link';
import { syncStateRepo } from '@kiko/sync-state/sync-state.repo';
import { refreshMarketData, warnRefreshFailure } from '@kiko/sync/refresh-market-data';

import { bankProviderRegistry } from '../../bank-sync/registry';
import { type SyncableAccount, syncJobsFor } from '../sync-jobs';
import { SYNC_CONCURRENCY_LIMIT, settleAllLimited } from '../settle-limited';
import { bankProviderIdOf, isBankProviderId } from '../../bank-sync/provider';

/**
 * Throttle window for the automatic on-open sync. Matches the rates cache
 * window in `rates-refresh.ts` (Monobank's `/bank/currency` is itself cached
 * upstream ~5 minutes), so an auto-sync never fires more often than the rate
 * data it also refreshes could usefully change.
 */
export const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The time throttle for the on-open sync: sync only when nothing has synced
 * within the window (or never has). The cursor lives PER CONNECTION in
 * `sync_state` (de-globalized from `settings` — see the `syncState` table
 * comment in `db/schema.ts`), so the throttle reads a connected BANK
 * account's own cursor — routed through `bankAccountIdFor` below, so the
 * next native provider (Guideline 5.6 remediation left Monobank as the sole
 * shipped one) throttles the exact same way without a rewrite here; a
 * crypto-only or fully manual user has none, so the throttle lets every
 * launch sync once (the per-mount `hasRun` ref still fires it at most once
 * per app open).
 */
export const throttleElapsed = (lastSyncAt: number | null, now: number): boolean =>
  lastSyncAt === null || now - lastSyncAt >= AUTO_SYNC_INTERVAL_MS;

/**
 * The first connected BANK account's id, for the throttle cursor — resolved
 * through the registry (`isBankProviderId`/`bankProviderIdOf`) rather than a
 * hardcoded `=== 'monobank'` check, so a later native provider is throttled
 * exactly like Monobank is today. `undefined` for a crypto-only or fully
 * manual account list.
 */
const bankAccountIdFor = (accounts: SyncableAccount[]): string | undefined =>
  accounts.find(
    (account) =>
      account.institution !== null && isBankProviderId(bankProviderIdOf(account.institution)),
  )?.id;

/**
 * Whether a connected BANK account's own credential is currently stored,
 * resolved through the registry — generalized off a hardcoded Monobank-only
 * `hasToken` gate, so a later native provider drops a credential-cleared
 * account the same way a tokenless Monobank one already is. `true` for a
 * non-bank (crypto) account, which needs no credential probe, and for a
 * bank id whose registry entry is not yet wired (defensive — `syncJobsFor`
 * already contributes no job for it either).
 */
const hasBankCredentials = async (account: SyncableAccount): Promise<boolean> => {
  if (account.institution === null) {
    return true;
  }

  const providerId = bankProviderIdOf(account.institution);

  if (!isBankProviderId(providerId)) {
    return true;
  }

  const entry = bankProviderRegistry[providerId];

  return entry ? entry.hasCredentials(account.id) : true;
};

/**
 * Runs one throttled background sync when the app opens, fanning out over EVERY
 * connected account — every connected bank account (Monobank today — routed
 * through the registry, so a later native provider joins for free) PLUS each
 * connected crypto account — exactly the set the pull-to-refresh fan-out
 * (`useSyncAll`) drives, so a crypto balance + Binance transaction import
 * happens on open, not only on pull. The jobs run settled under a bounded
 * worker pool (`settleAllLimited`, cap
 * `SYNC_CONCURRENCY_LIMIT`), so one account's failure never blocks the others
 * and a many-connection fan-out never fires every provider request at once;
 * rates refresh once for the batch.
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
      const accounts = await accountsRepo.listQuery();
      const bankAccountId = bankAccountIdFor(accounts);
      const syncStateRows =
        (await foldMap(maybe(bankAccountId), (id) => syncStateRepo.getQuery(id))) ?? [];
      const lastSyncAt = syncStateRows.at(0)?.lastSyncAt ?? null;

      if (!throttleElapsed(lastSyncAt, Date.now())) {
        return;
      }

      // Gate EACH connected bank account's job on its OWN registry-resolved
      // credential probe (a crypto account always passes, see
      // `hasBankCredentials`) — `syncJobsFor` is the same builder
      // pull-to-refresh uses.
      const jobLists = await Promise.all(
        accounts.map(async (account) => {
          if (!(await hasBankCredentials(account))) {
            return [];
          }

          return syncJobsFor(account);
        }),
      );
      const jobs = jobLists.flat();

      // Only the sync FAN-OUT is gated on having jobs; the refresh is
      // decoupled from it so a manual-only user still gets cross-rates
      // cached. Running it unconditionally is safe: `refreshMarketData` is
      // self-throttled (its own `refreshRates` step) and hits only PUBLIC,
      // tokenless endpoints. `refreshMarketData` runs rates and metals
      // CONCURRENTLY under its own `Promise.allSettled` (twin of
      // `useSyncAll`'s fan-out) and never rejects — it logs its own
      // rates/metals failure and returns a Left, which this effect passes to
      // `warnRefreshFailure` below instead of re-deriving it here.
      if (jobs.length > 0) {
        // Cap CONCURRENT syncs so a many-connection fan-out never fires N provider
        // requests at once (device load / provider rate limits) — see `settleAllLimited`.
        await settleAllLimited(
          jobs.map((job) => job.run),
          SYNC_CONCURRENCY_LIMIT,
        );
      }

      await refreshMarketData({ throttled: true, metals: true });
      // Same reasoning as `refreshMarketData` just above: an on-open sync can
      // bring in a new loan-payment debit, so the matcher runs alongside it.
      // Never rejects (its own doc comment), so a failed auto-link stays
      // inside this SAME swallowed-and-logged `either`, never a crash.
      await runLoanAutoLink();
    }).then((result) => {
      // The outer `either` still swallows every exception this effect can
      // throw (reading accounts/sync-state/credentials) — this hook has no
      // UI and must never crash the app on a background sync it did not ask
      // the user about — but a Left is now LOGGED, not silently dropped, the
      // same "log instead of drop" contract `refreshMarketData` established
      // for its own rates/metals steps.
      if (isLeft(result)) {
        warnRefreshFailure('auto-sync', bifold(result));
      }
    });
  }, []);
};
