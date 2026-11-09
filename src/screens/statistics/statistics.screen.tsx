import { match } from 'ts-pattern';
import {
  resolveTrendFilter,
  selectTopCategories,
  type TrendFilter,
} from '@kiko/statistics/trend-filter';
import { Money } from '@kiko/currency/money';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import {
  type AccountSlice,
  buildAccountContribution,
  buildDebtTotal,
} from '@kiko/statistics/account-contribution';
import {
  buildAccountOptions,
  buildCategoryOptions,
  excludedCategoryKeysOf,
  visibleCategorySelection,
} from '@kiko/statistics/statistics-filter-scope';
import Box from '@kiko/design-system/components/box';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import type { ScrollViewInstance } from 'react-native';
import { useIsLargeWindow } from '@kiko/display-regions';
import Button from '@kiko/design-system/components/button';
import { bucketDaysForSpan } from '@kiko/statistics/buckets';
import { endOfLocalDay, startOfLocalDay } from '@kiko/dates';
import { type FC, useEffect, useMemo, useState } from 'react';
import { useIsScreenVisible } from '@kiko/navigation/pane-stack';
import MoneyText from '@kiko/design-system/components/money-text';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import EmptyState from '@kiko/design-system/components/empty-state';
import FilterMenu from '@kiko/design-system/components/filter-menu';
import { buildTypeBreakdown } from '@kiko/statistics/type-breakdown';
import { openAccountForm } from '@kiko/navigation/open-account-form';
import { pastLimitsKeysOf } from '@kiko/crypto-sync/exchange/registry';
import LoadingState from '@kiko/design-system/components/loading-state';
import SummaryTable from '@kiko/design-system/components/summary-table';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { useStatisticsSources } from '@kiko/statistics/statistics-sources';
import DateRangeField from '@kiko/design-system/components/date-range-field';
import { type NavigationProp, useNavigation } from '@react-navigation/native';
import { useActiveColorScheme } from '@kiko/design-system/active-color-scheme';
import { accountDisplayName, hasNoAccounts } from '@kiko/holdings/implicit-account';
import Screen, { usePaneContentWidth } from '@kiko/design-system/components/screen';
import { useRateHistoryBackfill } from '@kiko/statistics/use-rate-history-backfill';
import { spendingRowsIn, useSpendingLedger } from '@kiko/statistics/spending-ledger';
import { useDateRangeSelection } from '@kiko/design-system/use-date-range-selection';
import type { StatisticsStackParamList, TabParamList } from '@kiko/navigation/types';
import { useVisibleRefreshedNow } from '@kiko/design-system/use-visible-refreshed-now';
import { useScrollToTopOnTabPress } from '@kiko/navigation/use-scroll-to-top-on-tab-press';
import { buildCategoryMeasures, buildCategoryTrend } from '@kiko/statistics/category-trend';
import { buildNetWorthSeries, transactionsByHolding } from '@kiko/statistics/net-worth-series';
import { buildCategoryBreakdown, type CategorySlice } from '@kiko/statistics/category-breakdown';
import { useStatisticsFilterSelection } from '@kiko/design-system/use-statistics-filter-selection';

import BarChart from './bar-chart';
import PieChart from './pie-chart';
import NetWorthLine from './net-worth-line';
import { styles } from './statistics.styles';
import TrendFilterField from './trend-filter-field';
import CategoryTrendLine from './category-trend-line';
import StatisticsGrid, { isChartRowShared } from './statistics-grid';

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

// The category-spending donut's ring is thinner than the default (a higher
// hole-radius-to-outer-radius ratio) than PieChart's own default, opening
// enough center room for its total figure — see `centerTotal` below. The
// account-contribution pie keeps PieChart's default ring; its own total
// already reads elsewhere on this screen (the by-type bar / net-worth line),
// so it renders no center total and has no need to thin its ring for one.
const CATEGORY_DONUT_INNER_RATIO = 0.78;

// The category donut can have a long tail of tiny categories, so its legend
// crops to categories at 5% share or more by default, with a "Show all" toggle
// to reveal the rest. The ring still draws every category. The
// account-contribution pie passes no threshold, so its legend is uncropped.
const CATEGORY_LEGEND_MIN_SHARE = 0.05;

// The gap between the net-worth card's title and its chart, in spacing units. The chart's scrub
// label may reach up into it, so the same value goes to both the `Box` and `NetWorthLine`.
const NET_WORTH_CARD_GAP = 3;

/**
 * The Statistics tab: five blocks, in order — a converted net-worth line over
 * time (historical rates), a by-type horizontal bar chart of current value, a
 * spending trend by category, an "Expenses by Category" donut, and a
 * per-account pie of current net worth. A shared account multi-select scopes
 * the blocks. The date range bounds the net-worth line's window, the trend's
 * window AND the category donut's transaction set; the by-type bar and the
 * account pie are "now" snapshots of current value and read no range at all.
 * The category donut additionally has its own, separate category filter
 * (title, then filter, then chart) and shows the summed spend at its center,
 * and the trend has its own filter. The bar and pies render immediately off the
 * current rate table; the line reads the historical rate-history table and
 * shows a loading state while an incremental, non-blocking backfill fills it
 * in. All the chart math lives in `src/statistics/`; this screen only shapes
 * repository rows, holds the filter state, and drives the backfill.
 */
const StatisticsScreen: FC = () => {
  const { t } = useTranslation();
  const scheme = useActiveColorScheme();
  // The card order and the shared row follow the window and the width the pane's content has (the
  // pane's, limited by the content cap), and nothing else: a filter or a date range never moves a
  // card. A window that is not large shows one column, every card full width (line, bar, pie,
  // donut, trend); a large one (every full-screen iPad) has room to share a row, so the trend
  // moves up and the donut and pie close the screen. The Help topic's steps follow the column.
  const isLargeWindow = useIsLargeWindow();
  const isRowShared = isChartRowShared(isLargeWindow, usePaneContentWidth());
  // A card keeps its own height, except in the shared row, where both cards take the row's and
  // each chart is centred in what is left under its title.
  const sharedCardStyle = isRowShared ? styles.sharedRowFill : undefined;
  const sharedChartStyle = isRowShared ? styles.chartBody : undefined;
  // This screen sits in its own tab's stack; the stack hands a navigate it
  // cannot answer (a jump to the Accounts tab) up to the tab navigator. The Tables screen sits in
  // the stack this screen is in, whichever tab's stack that is.
  const navigation = useNavigation<NavigationProp<TabParamList & StatisticsStackParamList>>();

  // Re-tapping the Statistics tab while already on it returns this scrolling
  // page to the top (the standard iOS active-tab re-tap), driven off the native
  // tab navigator's `tabPress`.
  const scrollRef = useAnimatedRef<ScrollViewInstance>();
  // The live `contentOffset.y`, so the hook can skip a redundant scroll.
  const scrollOffset = useScrollOffset(scrollRef);
  useScrollToTopOnTabPress(scrollRef, scrollOffset);

  // Visibility, not focus: as the Home tab's companion default this screen is on screen and
  // never the focused route.
  const isVisible = useIsScreenVisible();

  // A filter sheet is a native Modal: it stays presented over whatever tab the user switched to.
  // Both controls keep their open state to themselves, so they are mounted afresh, closed, each
  // time the screen stops being shown. Visibility, not focus, as above.
  const [sheetGeneration, setSheetGeneration] = useState(0);
  useEffect(() => {
    if (!isVisible) {
      setSheetGeneration((generation) => generation + 1);
    }
  }, [isVisible]);

  // An empty account set means "all accounts"; any account ids in it narrow all five charts.
  //
  // The spending pie's own category filter, in the SAME "empty means all" model
  // the account FilterMenu uses: an empty set includes every category; any
  // stable category KEYS in it narrow the pie to just those (never the
  // language-dependent display title — see categoryOptions below). Scoped to
  // that chart alone — the account filter and date range do not touch it, nor
  // it them.
  //
  // Both selections are shared with the other mounted Statistics screen (the tab
  // and the Home companion), like the date range below.
  const { selectedAccounts, selectedCategories, toggleAccount, toggleCategory } =
    useStatisticsFilterSelection();

  // `now` is seeded at mount and REFRESHED every time the screen becomes visible (see
  // useVisibleRefreshedNow): the default date-range seed, the default line window,
  // the backfill's "today", and every memo below key on it, and it stays stable
  // across renders so a fresh `Date.now()` each render never defeats that
  // memoization — only a return to visible advances it.
  const now = useVisibleRefreshedNow(isVisible);

  const { dateFrom, dateTo, applyDateRange, clearDateRange } = useDateRangeSelection(now);

  // The full transaction and lot span (`spanStart`) drives the date field's default display, the
  // line's default window, and the backfill's earliest day. `isReady` gates every chart below:
  // none renders an empty state while one of these queries is on its first load. That is
  // SEPARATE from the net-worth line's own `loading` prop, which tracks the incremental
  // rate-history backfill (a later, non-blocking concern once this base data has loaded).
  const {
    accounts,
    holdings,
    settingsRows,
    transactions,
    transactionsFresh,
    historyRows,
    historyFresh,
    categories,
    priceBook,
    isReady,
    baseCurrency,
    defaultCategoryKey,
    rateTable,
    categoryByKey,
    filtered,
    spanStart,
  } = useStatisticsSources({ isVisible, now, selectedAccounts });

  // The line's effective window: the picked range when set, otherwise the full
  // transaction span (earliest transaction to now). A PICKED bound is TRUE
  // local midnight (`startOfLocalDay`/`endOfLocalDay`, same helpers Home
  // uses), never a UTC-anchored approximation — a Kyiv (UTC+2/+3) pick using
  // `Date.UTC(y, m, d)` instead would exclude the first 2-3 local hours of
  // every picked day from this range, silently dropping them from the donut
  // and the net-worth line. The DEFAULT (unpicked) window is NOT
  // midnight-aligned: `rangeFrom` falls back to `spanStart` (the earliest
  // transaction's raw time, or `now` when there is none) and `rangeTo` falls
  // back to `now` itself. `buildNetWorthSeries` (below) does its OWN UTC-day
  // normalization per bucket internally (`dayKeyOf`, the bucket's local day, in
  // the same key shape as `currency_rate_history.day`) — that is a rate LOOKUP
  // KEY concern, entirely separate from these user-facing range bounds, and this
  // screen has no other UTC-day-key use, so no local `utcDayKey`-style helper
  // is needed here. A picked `to` bound extends to the end of its day so a
  // same-day pick still captures that day's buckets, DST-correct on a
  // 23/25-hour local day.
  const rangeFrom = dateFrom !== null ? startOfLocalDay(dateFrom.getTime()) : spanStart;
  const rangeTo = dateTo !== null ? endOfLocalDay(dateTo.getTime()) : now;

  // The bar and pie never wait on this: the backfill runs on its own and only the net-worth
  // line shows its status.
  const backfillStatus = useRateHistoryBackfill({
    transactions,
    holdings,
    historyRows,
    transactionsFresh,
    historyFresh,
    baseCurrency,
    spanStart,
    now,
  });

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
        book: priceBook,
      }),
    [filtered, rateTable, baseCurrency, now, priceBook],
  );

  const netWorth = useMemo(
    () =>
      buildNetWorthSeries({
        holdings: filtered.netWorthHoldings,
        transactionsByHolding: transactionsByHolding(transactions),
        historyRows,
        baseCurrency,
        range: { from: rangeFrom, to: rangeTo },
        bucketDays: bucketDaysForSpan(rangeTo - rangeFrom),
        // The live rates the bar/pie/headline use value today's buckets (so the
        // line's "now" reconciles with them) and back any currency with no stored
        // history in past buckets (flat at today's rate, no right-edge step).
        liveRateTable: rateTable,
        today: now,
        book: priceBook,
      }),
    [
      filtered,
      transactions,
      historyRows,
      baseCurrency,
      rangeFrom,
      rangeTo,
      rateTable,
      now,
      priceBook,
    ],
  );

  const slices = useMemo(
    () =>
      buildAccountContribution({
        // The legend names an implicit account by its display name; the stored
        // one is an English sentinel.
        accounts: filtered.filteredAccounts.map((account) => ({
          ...account,
          name: accountDisplayName(account, t),
        })),
        holdings: filtered.visibleHoldings,
        rateTable,
        baseCurrency,
        now,
        scheme,
        book: priceBook,
      }),
    [filtered, rateTable, baseCurrency, now, priceBook, t, scheme],
  );

  // The "Debts" total under the account pie
  // — every NEGATIVE holding value (a loan's own value, or a non-loan
  // holding in debit, e.g. a credit card), summed independently of the pie
  // (which shows only POSITIVE values).
  const debtTotal = useMemo(
    () =>
      buildDebtTotal({
        holdings: filtered.visibleHoldings,
        rateTable,
        baseCurrency,
        now,
        book: priceBook,
      }),
    [filtered, rateTable, baseCurrency, now, priceBook],
  );

  // The spending pie sums EXPENSE transactions (negative amounts) by category, in
  // the base currency. A transaction has no currency of its own — its amount is
  // in its holding's currency — so the ledger joins each transaction to its (account-scoped,
  // open) holding for the currency, dropping any whose holding is filtered out.
  // INTERNAL TRANSFERS (a matched -X / +X pair across two of the user's own
  // holdings, same currency, near-simultaneous) are not spending. Their debit
  // legs are dropped from the category breakdown by id; the credit legs are
  // already ignored as income. Scoped to THIS chart only — every other view
  // (net worth, by-type, account pie) still sees the full ledger.
  const spendingLedger = useSpendingLedger({
    transactions,
    holdings,
    accounts,
    shownHoldings: filtered.netWorthHoldings,
  });
  const { trendTransactions, excludedTransactionIds } = spendingLedger;

  // The active-range slice of the shown rows: this is what actually feeds the breakdown drawn on
  // screen (both the filter menu's option list and the pie itself — see
  // `allCategorySlices`/`categorySlices` below), so the donut and its center total agree with the
  // range field rendered above them.
  const rangeFilteredBreakdownTransactions = useMemo(
    () => spendingRowsIn(spendingLedger, rangeFrom, rangeTo),
    [spendingLedger, rangeFrom, rangeTo],
  );

  // The active-range breakdown of every spending category (category-filter-
  // unaware): it feeds the filter menu's option list, and — translated below
  // — the exclusion the pie applies. Scoped to `rangeFilteredBreakdownTransactions`
  // (not the full `breakdownTransactions`) so the filter menu never offers a
  // category with zero spending IN the visible range.
  const allCategorySlices = useMemo(
    () =>
      buildCategoryBreakdown({
        transactions: rangeFilteredBreakdownTransactions,
        categoryDisplay: categoryByKey,
        rateTable,
        baseCurrency,
        defaultCategoryKey,
        excludedTransactionIds,
        scheme,
      }),
    [
      rangeFilteredBreakdownTransactions,
      categoryByKey,
      rateTable,
      baseCurrency,
      defaultCategoryKey,
      excludedTransactionIds,
      scheme,
    ],
  );

  // The APPLIED trend filter: the saved config resolved against the categories
  // that still exist (manual keys pruned, top amount clamped), falling
  // back to the default (top 3 by contribution) when nothing is saved. Save
  // persists it and the value flows back through the settings live query — there
  // is no seed effect any more. Computed here (ahead of `categoryOptions`
  // below, which unions its manual keys back in) since it depends on neither.
  const appliedTrendFilter = useMemo(() => {
    const existingKeys = new Set(categories.map((category) => category.key.toLowerCase()));

    return resolveTrendFilter(settingsRows.at(0)?.trendFilter ?? null, existingKeys);
  }, [settingsRows, categories]);

  // The FilterMenu matches/stores by the STABLE `categories.key` slug, never by the resolved
  // display title (the same bug the Home screen's category filter had — see category-display.ts's
  // resolveCategoryKey). A selection is translated back into the set of KEYS to EXCLUDE from the
  // pie. The trend Filters sheet reuses this same option list (`TrendFilterField`'s own
  // `categoryOptions` prop), so a manual trend key is kept in it as well as a selected category.
  const categoryOptions = useMemo(
    () =>
      buildCategoryOptions({
        slices: allCategorySlices,
        categories,
        categoryByKey,
        keptKeys: [
          ...selectedCategories,
          ...(appliedTrendFilter.mode === 'manual' ? appliedTrendFilter.keys : []),
        ],
        scheme,
      }),
    [allCategorySlices, categories, selectedCategories, categoryByKey, appliedTrendFilter, scheme],
  );

  const visibleSelectedCategories = useMemo(
    () => visibleCategorySelection(selectedCategories, categoryByKey, allCategorySlices),
    [selectedCategories, categoryByKey, allCategorySlices],
  );

  const excludedCategoryKeys = useMemo(
    () => excludedCategoryKeysOf(allCategorySlices, visibleSelectedCategories),
    [allCategorySlices, visibleSelectedCategories],
  );

  const categorySlices = useMemo(
    () =>
      buildCategoryBreakdown({
        transactions: rangeFilteredBreakdownTransactions,
        categoryDisplay: categoryByKey,
        rateTable,
        baseCurrency,
        defaultCategoryKey,
        excludedCategories: excludedCategoryKeys,
        excludedTransactionIds,
        scheme,
      }),
    [
      rangeFilteredBreakdownTransactions,
      categoryByKey,
      rateTable,
      baseCurrency,
      defaultCategoryKey,
      excludedCategoryKeys,
      excludedTransactionIds,
      scheme,
    ],
  );

  // The per-category ranking measures over the SAME range/bucket set the
  // trend line and the net-worth line both use — the universe both the Top-N
  // ranking and the exclusion set below are computed from.
  const trendMeasures = useMemo(
    () =>
      buildCategoryMeasures({
        transactions: trendTransactions,
        categoryDisplay: categoryByKey,
        rateTable,
        baseCurrency,
        defaultCategoryKey,
        range: { from: rangeFrom, to: rangeTo },
        bucketDays: bucketDaysForSpan(rangeTo - rangeFrom),
        excludedTransactionIds,
      }),
    [
      trendTransactions,
      categoryByKey,
      rateTable,
      baseCurrency,
      defaultCategoryKey,
      rangeFrom,
      rangeTo,
      excludedTransactionIds,
    ],
  );

  // The category keys the chart draws: the explicit manual keys, or the live
  // top-N picked from the measures by the chosen measure.
  const trendSelectedKeys = useMemo(
    () =>
      match(appliedTrendFilter)
        .with({ mode: 'manual' }, (filter) => new Set(filter.keys))
        .with({ mode: 'top' }, (filter) =>
          selectTopCategories({ measures: trendMeasures, amount: filter.amount, by: filter.by }),
        )
        .exhaustive(),
    [appliedTrendFilter, trendMeasures],
  );

  // Feed the selection through the EXISTING exclusion path: exclude every
  // windowed category NOT selected, so `CategoryTrendLine` rendering is
  // unchanged. An empty selection (manual "all") excludes nothing.
  const excludedTrendCategoryKeys = useMemo(() => {
    if (trendSelectedKeys.size === 0) {
      return new Set<string>();
    }

    return new Set(
      trendMeasures.map((measure) => measure.key).filter((key) => !trendSelectedKeys.has(key)),
    );
  }, [trendMeasures, trendSelectedKeys]);

  // The chart's own bucket set is the SAME range/bucketDays the net-worth line
  // plots, so both charts share one X-axis convention (see `buildNetWorthSeries`
  // above).
  const trendSeries = useMemo(
    () =>
      buildCategoryTrend({
        transactions: trendTransactions,
        categoryDisplay: categoryByKey,
        rateTable,
        baseCurrency,
        defaultCategoryKey,
        range: { from: rangeFrom, to: rangeTo },
        bucketDays: bucketDaysForSpan(rangeTo - rangeFrom),
        excludedCategories: excludedTrendCategoryKeys,
        excludedTransactionIds,
        scheme,
      }),
    [
      trendTransactions,
      categoryByKey,
      rateTable,
      baseCurrency,
      defaultCategoryKey,
      rangeFrom,
      rangeTo,
      excludedTrendCategoryKeys,
      excludedTransactionIds,
      scheme,
    ],
  );

  // Save applies AND persists the whole filter; the applied config flows back
  // through the settings live query on the next render, so there is nothing to
  // hold in local state.
  const saveTrendFilter = (filter: TrendFilter): void => {
    settingsRepo.setTrendFilter(filter);
  };

  // The donut's own center figure: every VISIBLE slice's spend summed back
  // together, in the base currency — the total the ring's wedges add up to
  // right now, so it always reconciles with what is actually drawn (narrowed
  // by the category filter the same way the wedges are).
  const categoryTotal = useMemo(
    () =>
      Money.of(
        baseCurrency,
        categorySlices.reduce((sum, slice) => sum + slice.amount, 0),
      ),
    [categorySlices, baseCurrency],
  );

  const accountOptions = buildAccountOptions(filtered.optionAccounts, t, scheme);

  if (!isReady) {
    return (
      <Screen scroll scrollableRef={scrollRef}>
        <LoadingState testID="statistics-loading" />
      </Screen>
    );
  }

  if (hasNoAccounts(accounts, holdings)) {
    return (
      <Screen scroll scrollableRef={scrollRef}>
        <Box style={styles.empty}>
          <EmptyState
            icon={genericEntitySymbol.account}
            title={t('emptyStates.noAccounts.title')}
            message={t('emptyStates.noAccounts.message')}
            action={{
              label: t('accounts.addAccount'),
              icon: genericEntitySymbol.account,
              onPress: () => openAccountForm(navigation),
            }}
            testID="statistics-empty"
          />
        </Box>
      </Screen>
    );
  }

  const netWorthCard = (
    <Card key="statistics-block-line" testID="statistics-block-line" padding={4} radius="lg">
      <Box gap={NET_WORTH_CARD_GAP}>
        <Text variant="heading" style={styles.cardTitle}>
          {t('statistics.netWorthOverTime')}
        </Text>

        <NetWorthLine
          points={netWorth.points}
          startReference={netWorth.startReference}
          baseCurrency={baseCurrency}
          loading={backfillStatus.state === 'loading'}
          spaceAbove={NET_WORTH_CARD_GAP}
        />

        {pastLimitsKeysOf(filtered.filteredAccounts.map(({ institution }) => institution)).map(
          (key) => (
            <Text key={key} variant="caption" tone="textSecondary">
              {t(key)}
            </Text>
          ),
        )}
      </Box>
    </Card>
  );

  const byTypeCard = (
    <Card key="statistics-block-bar" testID="statistics-block-bar" padding={4} radius="lg">
      <Box gap={3}>
        <Text variant="heading" style={styles.cardTitle}>
          {t('statistics.byType')}
        </Text>

        <BarChart data={typeSlices} baseCurrency={baseCurrency} />
      </Box>
    </Card>
  );

  const trendCard = (
    <Card key="statistics-block-trend" testID="statistics-block-trend" padding={4} radius="lg">
      <Box gap={3}>
        <Text variant="heading" style={styles.cardTitle}>
          {t('statistics.spendingTrendByCategory')}
        </Text>

        <Box direction="row" style={styles.filterBar}>
          <TrendFilterField
            key={sheetGeneration}
            testID="statistics-trend-filter"
            filter={appliedTrendFilter}
            categoryOptions={categoryOptions}
            onSave={saveTrendFilter}
          />
        </Box>

        <CategoryTrendLine
          series={trendSeries}
          baseCurrency={baseCurrency}
          emptyLabel={t('statistics.noSpendingToShow')}
        />
      </Box>
    </Card>
  );

  const categoryCard = (
    <Card
      key="statistics-block-category"
      testID="statistics-block-category"
      padding={4}
      radius="lg"
      style={sharedCardStyle}
    >
      <Box gap={3} style={sharedCardStyle}>
        <Text variant="heading" style={styles.cardTitle}>
          {t('statistics.expensesByCategory')}
        </Text>

        <Box direction="row" gap={3} style={styles.filterBar}>
          <FilterMenu
            key={sheetGeneration}
            label={t('statistics.filterCategories')}
            sheetTitle={t('statistics.filterCategoriesSheetTitle')}
            testID="statistics-category-filter"
            options={categoryOptions}
            selected={visibleSelectedCategories}
            onToggle={toggleCategory}
            triggerIcon={genericEntitySymbol.category}
          />
        </Box>

        <Box style={sharedChartStyle} testID="statistics-chart-body-category">
          <PieChart
            slices={categorySlices.map(toPieSlice)}
            baseCurrency={baseCurrency}
            testID="category-pie"
            emptyLabel={t('statistics.noSpendingToShow')}
            innerRatio={CATEGORY_DONUT_INNER_RATIO}
            centerTotal={categoryTotal}
            legendMinShare={CATEGORY_LEGEND_MIN_SHARE}
          />
        </Box>
      </Box>
    </Card>
  );

  const accountContributionCard = (
    <Card
      key="statistics-block-pie"
      testID="statistics-block-pie"
      padding={4}
      radius="lg"
      style={sharedCardStyle}
    >
      <Box gap={3} style={sharedCardStyle}>
        <Text variant="heading" style={styles.cardTitle}>
          {t('statistics.accountContribution')}
        </Text>

        <Box gap={3} style={sharedChartStyle} testID="statistics-chart-body-pie">
          <PieChart slices={slices} baseCurrency={baseCurrency} />

          {!debtTotal.isZero() && (
            // SummaryTable is the shared "label left, value right" layout
            // every other summary line in the app already uses, rather
            // than a hand-built flexDirection row.
            <SummaryTable
              testID="statistics-debts-total"
              rows={[
                {
                  key: 'debts',
                  label: t('statistics.debtsTotal'),
                  value: <MoneyText money={debtTotal} context="balance" />,
                },
              ]}
            />
          )}
        </Box>
      </Box>
    </Card>
  );

  return (
    <Screen scroll scrollableRef={scrollRef}>
      <Box gap={4} testID="statistics-blocks">
        {/* One untagged box holds the Tables button and the filter bar, so the grid's children
            below keep their place in `statistics-blocks`. */}
        <Box gap={3}>
          <Button
            variant="secondaryTonal"
            size="compact"
            icon="tablecells"
            onPress={() => navigation.navigate('Tables')}
            testID="statistics-open-tables"
          >
            {t('statistics.openTables')}
          </Button>

          <Box direction="row" gap={3} style={styles.filterBar}>
            <FilterMenu
              key={sheetGeneration}
              label={t('statistics.filterAccounts')}
              sheetTitle={t('statistics.filterAccountsSheetTitle')}
              testID="statistics-account-filter"
              options={accountOptions}
              selected={filtered.visibleSelectedAccounts}
              onToggle={toggleAccount}
              triggerIcon="tray"
            />

            {/* A sibling of the account filter, whose key is the bare generation. */}
            <DateRangeField
              key={`date-range-${sheetGeneration}`}
              dateFrom={dateFrom}
              dateTo={dateTo}
              minDate={new Date(spanStart)}
              maxDate={new Date(now)}
              onApply={applyDateRange}
              onClear={clearDateRange}
            />
          </Box>
        </Box>

        <StatisticsGrid
          isRowShared={isRowShared}
          fullWidth={
            isLargeWindow
              ? [netWorthCard, byTypeCard, trendCard]
              : [netWorthCard, byTypeCard, accountContributionCard, categoryCard, trendCard]
          }
          shared={isLargeWindow ? [categoryCard, accountContributionCard] : []}
        />
      </Box>
    </Screen>
  );
};

export default StatisticsScreen;
