import either from 'fnts/either';
import { useEffect, useRef } from 'react';

import { runSync } from '../monobank/sync';
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
 * account is connected AND either no sync has ever run, or the last one is
 * older than the throttle window.
 */
export const shouldAutoSync = ({
  connected,
  lastSyncAt,
  now,
}: {
  connected: boolean;
  lastSyncAt: number | null;
  now: number;
}): boolean => connected && (lastSyncAt === null || now - lastSyncAt >= AUTO_SYNC_INTERVAL_MS);

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
      const [connectedAccounts, settingsRows] = await Promise.all([
        accountsRepo.connectedQuery(),
        settingsRepo.getQuery(),
      ]);
      const connectedAccountId = connectedAccounts.at(0)?.id;
      const connected = connectedAccountId !== undefined;
      const lastSyncAt = settingsRows.at(0)?.lastSyncAt ?? null;

      if (!shouldAutoSync({ connected, lastSyncAt, now: Date.now() })) {
        return;
      }

      await runSync({ targetAccountId: connectedAccountId });
      const lastRefreshAt = await ratesRepo.latestFetchedAt();
      await refreshRates({ lastRefreshAt });
    });
  }, []);
};
