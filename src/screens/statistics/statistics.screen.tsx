import { type FC, useEffect, useMemo, useRef, useState } from 'react';
import type { Currency } from '../../currency/currency';
import { DAY_MS } from '../../dates/duration';
import { useLiveQuery } from '../../db/use-live-query';
import BarChart from '../../design-system/components/bar-chart';
import Box from '../../design-system/components/box';
import GlassSurface from '../../design-system/components/glass-surface';
import NetWorthLine from '../../design-system/components/net-worth-line';
import PieChart from '../../design-system/components/pie-chart';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import {
  type BackfillStatus,
  deriveLastBackfilledDay,
  missingDays,
  runBackfill,
} from '../../rates/history-backfill';
import { buildRateTable } from '../../rates/net-worth-view';
import { accountsRepo } from '../../repositories/accounts.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { rateHistoryRepo } from '../../repositories/rate-history.repo';
import { ratesRepo } from '../../repositories/rates.repo';
import { settingsRepo } from '../../repositories/settings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';
import { buildAccountContribution } from '../../statistics/account-contribution';
import { bucketDaysForSpan, type SeriesTransaction } from '../../statistics/currency-series';
import { buildNetWorthSeries } from '../../statistics/net-worth-series';
import { buildTypeBreakdown } from '../../statistics/type-breakdown';
import DateRangeField from '../home/date-range-field';
import FilterMenu, { FILTER_ALL } from '../home/filter-menu';
import { styles } from './statistics.styles';

// Midnight (local) of the calendar day a timestamp falls on — the net-worth
// line's range bounds snap to whole days so the same-day picks a user makes in
// the date field map cleanly onto the daily buckets the series is computed over.
const startOfLocalDay = (time: number): number => {
  const date = new Date(time);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

// The `FILTER_ALL` chip clears the account dimension; any other value toggles
// in/out. A fresh Set keeps the state update immutable.
const toggleAccount =
  (setSelected: (updater: (previous: Set<string>) => Set<string>) => void) =>
  (value: string): void => {
    if (value === FILTER_ALL) {
      setSelected(() => new Set());

      return;
    }

    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }

      return next;
    });
  };

// Group the whole ledger by holding id so the net-worth series can reconstruct
// each holding's running balance over time. Keyed by holding, not account,
// because a holding's balance is what the series values at each day.
const groupByHolding = (
  transactions: { holdingId: string; time: number; amountMinorUnits: number }[],
): Map<string, SeriesTransaction[]> => {
  const byHolding = new Map<string, SeriesTransaction[]>();

  for (const transaction of transactions) {
    const list = byHolding.get(transaction.holdingId) ?? [];
    list.push({ time: transaction.time, amountMinorUnits: transaction.amountMinorUnits });
    byHolding.set(transaction.holdingId, list);
  }

  return byHolding;
};

/**
 * The Statistics tab: three blocks, in order — a by-type horizontal bar chart of
 * current value, a converted net-worth line over time (historical rates), and a
 * per-account pie of current net worth. A shared account multi-select and a date
 * range scope all three; the date range additionally bounds the line's window.
 * The bar and pie are "now" snapshots on the current rate table and render
 * immediately; the line reads the historical rate-history table and shows a
 * loading state while an incremental, non-blocking backfill fills it in. All the
 * chart math lives in `src/statistics/`; this screen only shapes repository rows,
 * holds the filter state, and drives the backfill.
 */
const StatisticsScreen: FC = () => {
  const { data: accounts } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const { data: transactions } = useLiveQuery(transactionsRepo.listAllQuery(), ['transactions']);
  const { data: historyRows } = useLiveQuery(rateHistoryRepo.historyRowsQuery(), [
    'currency_rate_history',
  ]);

  // An empty set means "all accounts"; any names in it narrow all three charts.
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());

  // A null bound leaves that side of the line's window at its default (earliest
  // transaction on the `from` side, now on the `to` side).
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);

  const applyDateRange = (from: Date | null, to: Date | null): void => {
    setDateFrom(from);
    setDateTo(to);
  };

  const clearDateRange = (): void => {
    setDateFrom(null);
    setDateTo(null);
  };

  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';

  // `now` is fixed at mount: the default line window, the backfill's "today", and
  // every memo below key on it, and a fresh `Date.now()` each render would defeat
  // that memoization.
  const now = useMemo(() => Date.now(), []);
  const rateTable = useMemo(() => buildRateTable(rates), [rates]);

  // Only non-archived accounts are ever shown; the account filter narrows within
  // those, and a holding then feeds the charts only when it is open AND its
  // account survived that filter. Memoized so all three builders below key off a
  // stable collection instead of a fresh array on every render.
  const filtered = useMemo(() => {
    const visibleAccounts = accounts.filter((account) => account.archivedAt == null);
    const filteredAccounts = visibleAccounts.filter(
      (account) => selectedAccounts.size === 0 || selectedAccounts.has(account.name),
    );
    const filteredAccountIds = new Set(filteredAccounts.map((account) => account.id));
    const visibleHoldings = holdings.filter(
      (holding) => holding.closedAt == null && filteredAccountIds.has(holding.accountId),
    );

    return { visibleAccounts, filteredAccounts, visibleHoldings };
  }, [accounts, holdings, selectedAccounts]);

  // The full transaction span drives the date field's default display, the line's
  // default window, and the backfill's earliest day. With no transactions the
  // start falls back to now.
  const transactionTimes = transactions.map((transaction) => transaction.time);
  const spanStart = transactionTimes.length > 0 ? Math.min(...transactionTimes) : now;

  // The line's effective window: the picked range when set, otherwise the full
  // transaction span (earliest transaction to now). The `to` bound extends to the
  // end of its day so a same-day pick still captures that day's buckets.
  const rangeFrom = dateFrom !== null ? startOfLocalDay(dateFrom.getTime()) : spanStart;
  const rangeTo = dateTo !== null ? startOfLocalDay(dateTo.getTime()) + DAY_MS - 1 : now;

  // The resume point for the backfill: the newest day already stored, derived
  // from the history table itself (no extra persistence). Null when empty.
  const lastBackfilledDay = useMemo(() => deriveLastBackfilledDay(historyRows), [historyRows]);

  // Drive the incremental, non-blocking backfill and surface its status to the
  // line. It runs at most once per mount, only when there is a bounded span
  // (transactions exist) with days still to fill; the ref guards against the
  // re-render the backfill's own writes trigger (which advance `lastBackfilledDay`
  // and would otherwise re-enter). The bar and pie never wait on this.
  const backfillStartedRef = useRef(false);
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus>({
    state: 'idle',
    lastDay: null,
  });

  useEffect(() => {
    if (backfillStartedRef.current || transactions.length === 0) {
      return;
    }
    if (missingDays(spanStart, lastBackfilledDay, now).length === 0) {
      setBackfillStatus({ state: 'complete', lastDay: lastBackfilledDay });

      return;
    }

    backfillStartedRef.current = true;
    setBackfillStatus({ state: 'loading', lastDay: lastBackfilledDay });
    let cancelled = false;
    runBackfill({ earliestDay: spanStart, lastBackfilledDay, today: now })
      .then((status) => {
        if (!cancelled) {
          setBackfillStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBackfillStatus({ state: 'complete', lastDay: lastBackfilledDay });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [transactions.length, spanStart, lastBackfilledDay, now]);

  // Bar + pie value "now" on the current rate table; the line values each day on
  // the historical table. All three are memoized on their real inputs so they no
  // longer run every render; the line coarsens its day bucket on a long window
  // (see `bucketDaysForSpan`) so the point count stays bounded on multi-year
  // spans.
  const typeSlices = useMemo(
    () =>
      buildTypeBreakdown({
        holdings: filtered.visibleHoldings,
        rateTable,
        baseCurrency,
        now,
      }),
    [filtered, rateTable, baseCurrency, now],
  );

  const netWorth = useMemo(
    () =>
      buildNetWorthSeries({
        holdings: filtered.visibleHoldings,
        txByHolding: groupByHolding(transactions),
        historyRows,
        baseCurrency,
        range: { from: rangeFrom, to: rangeTo },
        bucketDays: bucketDaysForSpan(rangeTo - rangeFrom),
      }),
    [filtered, transactions, historyRows, baseCurrency, rangeFrom, rangeTo],
  );

  const slices = useMemo(
    () =>
      buildAccountContribution({
        accounts: filtered.filteredAccounts,
        holdings: filtered.visibleHoldings,
        rateTable,
        baseCurrency,
        now,
      }),
    [filtered, rateTable, baseCurrency, now],
  );

  const accountNames = filtered.visibleAccounts.map((account) => account.name);

  return (
    <Screen scroll>
      <Box gap={4} testID="statistics-blocks">
        <Box direction="row" gap={3} style={styles.filterBar}>
          <FilterMenu
            label="Accounts"
            testID="statistics-account-filter"
            options={accountNames}
            selected={selectedAccounts}
            onToggle={toggleAccount(setSelectedAccounts)}
          />

          <DateRangeField
            dateFrom={dateFrom}
            dateTo={dateTo}
            minDate={new Date(spanStart)}
            maxDate={new Date(now)}
            onApply={applyDateRange}
            onClear={clearDateRange}
          />
        </Box>

        <GlassSurface testID="statistics-block-bar" padding={4} radius="lg">
          <Box gap={3}>
            <Text variant="heading" style={styles.cardTitle}>
              By Type
            </Text>

            <BarChart data={typeSlices} baseCurrency={baseCurrency} />
          </Box>
        </GlassSurface>

        <GlassSurface testID="statistics-block-line" padding={4} radius="lg">
          <Box gap={3}>
            <Text variant="heading" style={styles.cardTitle}>
              Net Worth Over Time
            </Text>

            <NetWorthLine
              points={netWorth.points}
              startReference={netWorth.startReference}
              baseCurrency={baseCurrency}
              loading={backfillStatus.state === 'loading'}
            />
          </Box>
        </GlassSurface>

        <GlassSurface testID="statistics-block-pie" padding={4} radius="lg">
          <Box gap={3}>
            <Text variant="heading" style={styles.cardTitle}>
              Account Contribution
            </Text>

            <PieChart slices={slices} baseCurrency={baseCurrency} />
          </Box>
        </GlassSurface>
      </Box>
    </Screen>
  );
};

export default StatisticsScreen;
