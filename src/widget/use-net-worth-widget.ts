import { useCallback, useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { Currency } from '../currency/currency';
import { DAY_MS } from '../dates/duration';
import type { AccountRow, CurrencyRateHistoryRow, HoldingRow } from '../db/schema';
import { useLiveQuery } from '../db/use-live-query';
import { activeHoldings } from '../rates/active-holdings';
import { buildRateTable } from '../rates/net-worth-view';
import { accountsRepo } from '../repositories/accounts.repo';
import { holdingsRepo } from '../repositories/holdings.repo';
import { rateHistoryRepo } from '../repositories/rate-history.repo';
import { ratesRepo } from '../repositories/rates.repo';
import { settingsRepo } from '../repositories/settings.repo';
import { transactionsRepo } from '../repositories/transactions.repo';
import type { SeriesTransaction } from '../statistics/holding-value-at';
import { buildNetWorthSeries } from '../statistics/net-worth-series';

import { buildNetWorthSnapshot, type NetWorthSnapshot } from './net-worth-snapshot';
import { widgetBridge } from './widget-bridge';

// Coalesces rapid live-query refreshes (e.g. several rows touched by one sync)
// into a single write instead of one per row change.
const DEBOUNCE_MS = 500;

// The widget's trend covers the last 30 days only — a fixed, recent window,
// unlike the Statistics screen's user-adjustable range.
const TREND_WINDOW_DAYS = 30;

type LedgerTransaction = { holdingId: string; time: number; amountMinorUnits: number };

// Groups the whole ledger by holding id, mirroring `statistics.screen.tsx`'s
// own `groupByHolding` (not imported from there — the widget must never
// depend on a screen file). `buildNetWorthSeries` reconstructs each holding's
// running balance over time from this.
const groupByHolding = (transactions: LedgerTransaction[]): Map<string, SeriesTransaction[]> => {
  const byHolding = new Map<string, SeriesTransaction[]>();

  for (const transaction of transactions) {
    const list = byHolding.get(transaction.holdingId) ?? [];
    list.push({ time: transaction.time, amountMinorUnits: transaction.amountMinorUnits });
    byHolding.set(transaction.holdingId, list);
  }

  return byHolding;
};

// Pure assembly of the snapshot from the raw live-query rows: builds the rate
// table, the last-30-days trend (via `buildNetWorthSeries`, same builder the
// Statistics line uses), then the snapshot itself (via `buildNetWorthSnapshot`,
// Task 2) — never a second net-worth computation.
const assembleSnapshot = (input: {
  accounts: readonly AccountRow[];
  holdings: readonly HoldingRow[];
  rates: Parameters<typeof buildRateTable>[0];
  transactions: LedgerTransaction[];
  historyRows: Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate'>[];
  baseCurrency: Currency;
  now: number;
}): NetWorthSnapshot => {
  const rateTable = buildRateTable(input.rates);
  const active = activeHoldings(input.holdings, input.accounts);
  const series = buildNetWorthSeries({
    holdings: active,
    txByHolding: groupByHolding(input.transactions),
    historyRows: input.historyRows,
    baseCurrency: input.baseCurrency,
    range: { from: input.now - TREND_WINDOW_DAYS * DAY_MS, to: input.now },
    bucketDays: 1,
    liveRateTable: rateTable,
    today: input.now,
  });

  return buildNetWorthSnapshot({
    holdings: input.holdings,
    accounts: input.accounts,
    rateTable,
    baseCurrency: input.baseCurrency,
    trendPoints: series.points,
    now: input.now,
  });
};

/**
 * Keeps the home-screen widget's snapshot fresh. Runs the same live queries
 * the Statistics screen reads (holdings, accounts, rates, settings, the full
 * ledger, and rate-history rows), assembles a `NetWorthSnapshot` from them,
 * and writes it through `widgetBridge` — debounced, so a burst of underlying
 * writes settles into one snapshot write, and also immediately whenever the
 * app backgrounds, so the widget is current the moment the user leaves.
 * Side-effect only; renders nothing.
 */
export const useNetWorthWidget = (): void => {
  const { data: accounts } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const { data: transactions } = useLiveQuery(transactionsRepo.listAllQuery(), ['transactions']);
  const { data: historyRows } = useLiveQuery(rateHistoryRepo.historyRowsQuery(), [
    'currency_rate_history',
  ]);

  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  // The persisted language, in `writeNow`'s dependency list below: every
  // formatted string in the snapshot is locale-dependent (₴1,234.56 vs
  // 1 234,56 ₴, and since the widget's labels are carried in the snapshot, the
  // labels themselves), but a language switch writes only `settings.language` —
  // no other watched table, and `baseCurrency` is unchanged — so `writeNow`'s
  // identity was stable, the debounce never re-fired, and the widget kept the
  // previous locale until something unrelated changed.
  const language = settingsRows.at(0)?.language ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(language-dependent resolver) `assembleSnapshot` -> `buildNetWorthSnapshot` resolves `labels.title` through `i18n.t`, which reads the active language off the global i18next singleton rather than off anything in this closure — `language` is never read directly in the body above, but `writeNow`'s identity must still invalidate on it, or a language switch (which touches no other watched table and leaves `baseCurrency` unchanged) would never re-fire the debounced write.
  const writeNow = useCallback(async (): Promise<void> => {
    const snapshot = assembleSnapshot({
      accounts,
      holdings,
      rates,
      transactions,
      historyRows,
      baseCurrency,
      now: Date.now(),
    });

    await widgetBridge.writeSnapshot(snapshot);
    widgetBridge.reloadWidget();
  }, [accounts, holdings, rates, transactions, historyRows, baseCurrency, language]);

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
