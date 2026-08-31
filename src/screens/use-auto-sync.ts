import either from 'fnts/either';
import { useEffect, useRef } from 'react';

import { runSync } from '../monobank/sync';
import { readToken } from '../monobank/token';
import { refreshRates } from '../rates/rates-refresh';
import { accountsRepo } from '../repositories/accounts.repo';
import { ratesRepo } from '../repositories/rates.repo';
import { settingsRepo } from '../repositories/settings.repo';

/**
 * Throttle window for the automatic on-open sync. Matches the rates cache
 * window in `rates-refresh.ts` (Monobank's `/bank/currency` is itself cached
 * upstream ~5 minutes), so an auto-sync never fires more often than the rate
 * data it also refreshes could usefully change.
 */
export const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Pure gating decision for the auto-sync effect: sync only when a Monobank
 * account is connected, a token is stored, AND either no sync has ever run,
 * or the last one is older than the throttle window.
 */
export const shouldAutoSync = ({
  connected,
  hasToken,
  lastSyncAt,
  now,
}: {
  connected: boolean;
  hasToken: boolean;
  lastSyncAt: number | null;
  now: number;
}): boolean =>
  connected && hasToken && (lastSyncAt === null || now - lastSyncAt >= AUTO_SYNC_INTERVAL_MS);

/**
 * Runs one throttled background sync of the connected Monobank account when
 * the app opens. A one-shot read (not `useLiveQuery`) drives the throttle
 * decision, mirroring how `sync.ts` reads settings directly, so this never
 * re-fires as data changes underneath it. Any failure — reading the gating
 * data, `runSync`, or `refreshRates` — is swallowed: this hook has no UI and
 * must never crash the app on a background sync it didn't ask the user about.
 */
export const useAutoSync = (): void => {
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) {
      return;
    }
    hasRun.current = true;

    void either<unknown, void>(async () => {
      const [connectedAccounts, settingsRows, token] = await Promise.all([
        accountsRepo.connectedQuery(),
        settingsRepo.getQuery(),
        readToken(),
      ]);
      const connected = connectedAccounts.at(0)?.id !== undefined;
      const hasToken = token !== undefined;
      const lastSyncAt = settingsRows.at(0)?.lastSyncAt ?? null;

      if (!shouldAutoSync({ connected, hasToken, lastSyncAt, now: Date.now() })) {
        return;
      }

      await runSync();
      const lastRefreshAt = await ratesRepo.latestFetchedAt();
      await refreshRates({ lastRefreshAt });
    });
  }, []);
};
