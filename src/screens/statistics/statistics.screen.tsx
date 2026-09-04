import { type FC, useEffect, useMemo, useRef, useState } from 'react';
import { buildCategoryDisplayMap } from '../../categories/category-display';
import { excludeSelfTransfers } from '../../statistics/exclude-self-transfers';
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
import { resolveEntityColor } from '../../design-system/entity-tint';
import { defaultAccountColor } from '../../holdings/entity-colors';
import {
  type BackfillStatus,
  deriveLastBackfilledDay,
  missingDays,
  runBackfill,
} from '../../rates/history-backfill';
import { buildRateTable } from '../../rates/net-worth-view';
import { accountsRepo } from '../../repositories/accounts.repo';
import { categoriesRepo } from '../../repositories/categories.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { rateHistoryRepo } from '../../repositories/rate-history.repo';
import { ratesRepo } from '../../repositories/rates.repo';
import { settingsRepo } from '../../repositories/settings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';
import { type AccountSlice, buildAccountContribution } from '../../statistics/account-contribution';
import { bucketDaysForSpan } from '../../statistics/buckets';
import {
  type BreakdownTransaction,
  buildCategoryBreakdown,
  type CategorySlice,
} from '../../statistics/category-breakdown';
import type { SeriesTransaction } from '../../statistics/holding-value-at';
import { buildNetWorthSeries } from '../../statistics/net-worth-series';
import { buildTypeBreakdown } from '../../statistics/type-breakdown';
import DateRangeField from '../home/date-range-field';
import FilterMenu, { FILTER_ALL, type FilterOption } from '../home/filter-menu';
import { styles } from './statistics.styles';

// UTC-midnight of the LOCAL calendar day a timestamp falls on. The date field's
// picks are local calendar days, but the rate history stores each day as its
// UTC-midnight instant; mapping the picked local day onto that UTC-midnight (not
// the local one) keeps the series' bucket lookups on the correct day. In a
// positive-UTC-offset locale (e.g. UA) a local-midnight bound sits on the
// previous UTC day, which would read the previous day's rate.
const startOfLocalDay = (time: number): number => {
  const date = new Date(time);

  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
};

// Adapt a category spending slice onto the shared `PieChart` slice shape: the
// category KEY is the slice identity (its React key + testID suffix), its title
// the legend label. Same donut, a spending-by-category dimension instead of
// per-account contribution.
const toPieSlice = (slice: CategorySlice): AccountSlice => ({
  accountId: slice.key,
  name: slice.title,
  amount: slice.amount,
  share: slice.share,
  color: slice.color,
});

// A FilterMenu toggle for either dimension (accounts, categories): the
// `FILTER_ALL` row clears the dimension; any other value toggles in/out. A fresh
// Set keeps the state update immutable.
const toggleFilter =
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
  const { data: categories } = useLiveQuery(categoriesRepo.allQuery(), ['categories']);

  // An empty set means "all accounts"; any names in it narrow all three charts.
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());

  // The spending pie's own category filter, in the SAME "empty means all" model
  // the account FilterMenu uses: an empty set includes every category; any
  // category titles in it narrow the pie to just those. Scoped to that chart
  // alone — the account filter and date range do not touch it, nor it them.
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

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
        // Value today's rightmost point on the same live rates the bar/pie/
        // headline use, so the line's "now" reconciles with them instead of
        // sitting a few percent off on the day's NBU official rate.
        liveRateTable: rateTable,
        today: now,
      }),
    [filtered, transactions, historyRows, baseCurrency, rangeFrom, rangeTo, rateTable, now],
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

  // The spending pie sums EXPENSE transactions (negative amounts) by category, in
  // the base currency. A transaction has no currency of its own — its amount is
  // in its holding's currency — so join each transaction to its (account-scoped,
  // open) holding for the currency, dropping any whose holding is filtered out.
  // The category display map is built here so a rename flows straight through.
  const categoryByKey = useMemo(() => buildCategoryDisplayMap(categories), [categories]);

  const breakdownTransactions = useMemo<BreakdownTransaction[]>(() => {
    const currencyByHolding = new Map(
      filtered.visibleHoldings.map((holding) => [holding.id, holding.currency]),
    );

    // Card-to-card SELF-TRANSFERS (a matched -X / +X pair across two of the
    // user's own holdings) are not spending, so drop both legs before the
    // category breakdown consumes them. Scoped to THIS chart only — every other
    // view (net worth, by-type, account pie) still sees the full ledger.
    return excludeSelfTransfers(transactions).flatMap((transaction) => {
      const currency = currencyByHolding.get(transaction.holdingId);
      if (currency === undefined) {
        return [];
      }

      return [
        {
          category: transaction.category,
          amountMinorUnits: transaction.amountMinorUnits,
          currency,
        },
      ];
    });
  }, [transactions, filtered]);

  // The unfiltered breakdown of every spending category: it feeds the filter
  // menu's option list, and — translated below — the exclusion the pie applies.
  const allCategorySlices = useMemo(
    () =>
      buildCategoryBreakdown({
        transactions: breakdownTransactions,
        categoryDisplay: categoryByKey,
        rateTable,
        baseCurrency,
      }),
    [breakdownTransactions, categoryByKey, rateTable, baseCurrency],
  );

  // The FilterMenu speaks category TITLES (the human-readable label a slug
  // resolves to); the breakdown groups by key. The menu's options are the
  // distinct titles, and a selection is translated back into the set of KEYS to
  // EXCLUDE from the pie: an empty selection excludes nothing (all included),
  // otherwise every category whose title is not selected is excluded. Each
  // option carries the slice's own icon + color for the menu row; matching still
  // keys on `option.value` (the title). De-duplicated by title, first-seen-wins.
  const categoryOptions = useMemo(() => {
    const byTitle = new Map<string, FilterOption>();
    for (const slice of allCategorySlices) {
      if (byTitle.has(slice.title)) {
        continue;
      }
      byTitle.set(slice.title, { value: slice.title, icon: slice.icon, color: slice.color });
    }

    return Array.from(byTitle.values());
  }, [allCategorySlices]);

  const excludedCategoryKeys = useMemo(() => {
    if (selectedCategories.size === 0) {
      return new Set<string>();
    }

    return new Set(
      allCategorySlices
        .filter((slice) => !selectedCategories.has(slice.title))
        .map((slice) => slice.key),
    );
  }, [allCategorySlices, selectedCategories]);

  const categorySlices = useMemo(
    () =>
      buildCategoryBreakdown({
        transactions: breakdownTransactions,
        categoryDisplay: categoryByKey,
        rateTable,
        baseCurrency,
        excludedCategories: excludedCategoryKeys,
      }),
    [breakdownTransactions, categoryByKey, rateTable, baseCurrency, excludedCategoryKeys],
  );

  // One option per visible account, each carrying its seeded icon + resolved
  // entity color for the menu row; matching still keys on `option.value` (the
  // account name, compared to `account.name` in the `filtered` memo above).
  const accountOptions: FilterOption[] = filtered.visibleAccounts.map((account) => ({
    value: account.name,
    icon: account.icon ?? undefined,
    color: resolveEntityColor(account.color, defaultAccountColor[account.kind]),
  }));

  return (
    <Screen scroll>
      <Box gap={4} testID="statistics-blocks">
        <Box direction="row" gap={3} style={styles.filterBar}>
          <FilterMenu
            label="Accounts"
            testID="statistics-account-filter"
            options={accountOptions}
            selected={selectedAccounts}
            onToggle={toggleFilter(setSelectedAccounts)}
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

        <GlassSurface testID="statistics-block-category" padding={4} radius="lg">
          <Box gap={3}>
            <Box direction="row" gap={3} style={styles.filterBar}>
              <FilterMenu
                label="Categories"
                testID="statistics-category-filter"
                options={categoryOptions}
                selected={selectedCategories}
                onToggle={toggleFilter(setSelectedCategories)}
              />
            </Box>

            <PieChart
              slices={categorySlices.map(toPieSlice)}
              baseCurrency={baseCurrency}
              testID="category-pie"
              emptyLabel="No Spending To Show"
            />
          </Box>
        </GlassSurface>
      </Box>
    </Screen>
  );
};

export default StatisticsScreen;
