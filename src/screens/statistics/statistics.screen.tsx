import { type FC, useMemo, useState } from 'react';
import type { Currency } from '../../currency/currency';
import { DAY_MS } from '../../dates/duration';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import GlassSurface from '../../design-system/components/glass-surface';
import LineChart from '../../design-system/components/line-chart';
import PieChart from '../../design-system/components/pie-chart';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import { buildRateTable } from '../../rates/net-worth-view';
import { accountsRepo } from '../../repositories/accounts.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { ratesRepo } from '../../repositories/rates.repo';
import { settingsRepo } from '../../repositories/settings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';
import { buildAccountContribution } from '../../statistics/account-contribution';
import {
  bucketDaysForSpan,
  buildCurrencySeries,
  type SeriesTransaction,
} from '../../statistics/currency-series';
import DateRangeField from '../home/date-range-field';
import FilterMenu, { FILTER_ALL } from '../home/filter-menu';
import { styles } from './statistics.styles';

// Midnight (local) of the calendar day a timestamp falls on — the line chart's
// range bounds snap to whole days so the same-day picks a user makes in the
// date field map cleanly onto the daily buckets the series is computed over.
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

// Group the whole ledger by holding id so the line chart can reconstruct each
// holding's running balance over time. Keyed by holding, not account, because a
// holding's balance is what the series indexes.
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
 * The Statistics tab: a per-currency indexed line chart of balance over time and
 * a per-account pie chart of current net worth, both filtered by a shared
 * account multi-select and a date range that scopes the line's window. All the
 * chart math lives in `src/statistics/`; this screen only shapes repository rows
 * and holds the filter state.
 */
const StatisticsScreen: FC = () => {
  const { data: accounts } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const { data: transactions } = useLiveQuery(transactionsRepo.listAllQuery(), ['transactions']);

  // An empty set means "all accounts"; any names in it narrow both charts.
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

  // `now` is fixed at mount: the default line window and every memo below key on
  // it, and a fresh `Date.now()` each render would defeat that memoization.
  const now = useMemo(() => Date.now(), []);
  const rateTable = useMemo(() => buildRateTable(rates), [rates]);

  // Only non-archived accounts are ever shown; the account filter narrows within
  // those, and a holding then feeds either chart only when it is open AND its
  // account survived that filter. Memoized so both chart builders below key off
  // a stable collection instead of a fresh array on every render.
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

  // The full transaction span drives the date field's default display and the
  // line's default window. With no transactions the start falls back to now.
  const transactionTimes = transactions.map((transaction) => transaction.time);
  const spanStart = transactionTimes.length > 0 ? Math.min(...transactionTimes) : now;

  // The line's effective window: the picked range when set, otherwise the full
  // transaction span (earliest transaction to now). The `to` bound extends to
  // the end of its day so a same-day pick still captures that day's buckets.
  const rangeFrom = dateFrom !== null ? startOfLocalDay(dateFrom.getTime()) : spanStart;
  const rangeTo = dateTo !== null ? startOfLocalDay(dateTo.getTime()) + DAY_MS - 1 : now;

  // Both builders are memoized on their real inputs so they no longer run every
  // render; the line coarsens its day bucket on a long window (see
  // `bucketDaysForSpan`) so the point count stays bounded on multi-year spans.
  const series = useMemo(
    () =>
      buildCurrencySeries({
        holdings: filtered.visibleHoldings,
        txByHolding: groupByHolding(transactions),
        range: { from: rangeFrom, to: rangeTo },
        bucketDays: bucketDaysForSpan(rangeTo - rangeFrom),
      }),
    [filtered, transactions, rangeFrom, rangeTo],
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
      <Box gap={4}>
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

        <GlassSurface padding={4} radius="lg">
          <Box gap={3}>
            <Text variant="heading" style={styles.cardTitle}>
              Balance Over Time
            </Text>

            <LineChart series={series} />
          </Box>
        </GlassSurface>

        <GlassSurface padding={4} radius="lg">
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
