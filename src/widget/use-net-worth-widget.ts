import { useCallback, useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { Currency } from '../currency/currency';
import { APP_LOCK_ENABLED } from '../db/db-config';
import { useLiveQuery } from '../db/use-live-query';
import { buildRateTable } from '../rates/net-worth-view';
import { accountsRepo } from '../repositories/accounts.repo';
import { holdingsRepo } from '../repositories/holdings.repo';
import { ratesRepo } from '../repositories/rates.repo';
import { settingsRepo } from '../repositories/settings.repo';

import { buildNetWorthSnapshot } from './net-worth-snapshot';
import { widgetBridge } from './widget-bridge';

// Coalesces rapid live-query refreshes (e.g. several rows touched by one sync)
// into a single write instead of one per row change.
const DEBOUNCE_MS = 500;

/**
 * Keeps the home-screen widget's snapshot fresh. Runs the same live queries the
 * home screen reads (holdings, accounts, rates, settings), builds a
 * `NetWorthSnapshot` through the app's own net-worth math, and writes it through
 * `widgetBridge` — debounced, so a burst of underlying writes settles into one
 * snapshot write, and also immediately whenever the app backgrounds, so the
 * widget is current the moment the user leaves. Side-effect only; renders
 * nothing.
 *
 * Both write opportunities are lock-aware: while the app lock is enabled they
 * clear the snapshot rather than write one (docs/security/README.md, S2/S3).
 * The hook is mounted under `LockGate`, so it only ever runs post-unlock.
 */
export const useNetWorthWidget = (): void => {
  const { data: accounts } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);

  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  // Mirrors `useAppLock`'s own derivation (src/auth/use-app-lock.ts): the lock is
  // only real when the compile-time master switch is on AND the user enabled it.
  const lockEnabled = APP_LOCK_ENABLED && (settingsRows.at(0)?.lockEnabled ?? false);

  const writeNow = useCallback(async (): Promise<void> => {
    // Lock on: leave no real snapshot on disk; the next tick after the user
    // turns the lock off writes one again.
    if (lockEnabled) {
      await widgetBridge.clearSnapshot();
      widgetBridge.reloadWidget();

      return;
    }

    const snapshot = buildNetWorthSnapshot({
      holdings,
      accounts,
      rateTable: buildRateTable(rates),
      baseCurrency,
      now: Date.now(),
    });

    await widgetBridge.writeSnapshot(snapshot);
    widgetBridge.reloadWidget();
  }, [accounts, holdings, rates, baseCurrency, lockEnabled]);

  useEffect(() => {
    const timer = setTimeout(() => {
      writeNow().catch(() => {});
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [writeNow]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'background') {
        return;
      }

      writeNow().catch(() => {});
    });

    return () => {
      subscription.remove();
    };
  }, [writeNow]);
};
