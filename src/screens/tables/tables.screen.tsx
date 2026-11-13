import { match } from 'ts-pattern';
import {
  monthsOfPeriod,
  resolveTablePeriod,
  tablePeriodOptions,
} from '@kiko/statistics/table-period';
import { useTranslation } from 'react-i18next';
import {
  buildAccountOptions,
  buildCategoryOptions,
  excludedCategoryKeysOf,
  visibleCategorySelection,
} from '@kiko/statistics/statistics-filter-scope';
import Box from '@kiko/design-system/components/box';
import { rowContextOf } from '@kiko/statistics/cell-rows';
import Screen from '@kiko/design-system/components/screen';
import { useVerticalBarEdge } from '@kiko/display-regions';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import FilterMenu from '@kiko/design-system/components/filter-menu';
import { useSpendingLedger } from '@kiko/statistics/spending-ledger';
import LoadingState from '@kiko/design-system/components/loading-state';
import { useAnimatedHeaderHeight } from '@react-navigation/native-stack';
import { useStatisticsSources } from '@kiko/statistics/statistics-sources';
import { type FC, useCallback, useEffect, useMemo, useState } from 'react';
import { categorySlicesOfMonths } from '@kiko/statistics/category-by-month';
import { TABLES_VIEWS, type TablesView } from '@kiko/statistics/tables-view';
import { useActiveColorScheme } from '@kiko/design-system/active-color-scheme';
import SegmentedControl from '@kiko/design-system/components/segmented-control';
import type { TablesParams, TransactionFormParams } from '@kiko/navigation/types';
import { useRateHistoryBackfill } from '@kiko/statistics/use-rate-history-backfill';
import { useVisibleRefreshedNow } from '@kiko/design-system/use-visible-refreshed-now';
import { useIsScreenVisible, useSettledLayoutMode } from '@kiko/navigation/pane-stack';
import { useTablesPeriodSelection } from '@kiko/statistics/use-tables-period-selection';
import { useStatisticsFilterSelection } from '@kiko/design-system/use-statistics-filter-selection';

import { styles } from './tables.styles';
import CategoryTable from './category-table';
import CashFlowTable from './cash-flow-table';
import NetWorthTable from './net-worth-table';
import TablePeriodField from './table-period-field';

// This screen is registered in the Home and the Statistics stacks (the Statistics screen that
// opens it shows in either), so it binds no stack's param list: it needs the route's params,
// `setParams`, and what it opens a transaction with, which both stacks' generated props satisfy.
type TablesScreenProps = {
  route: { params?: TablesParams };
  navigation: {
    setParams: (params: TablesParams) => void;
    navigate: (name: 'TransactionForm', params: TransactionFormParams) => void;
    goBack: () => void;
    getState: () => { routes: { name: string; params?: object }[] };
  };
};

// A table without a category column has no use for the category filter, and a view added to the
// union is a compile error here until it says whether it has one.
const HAS_CATEGORY_FILTER: Record<TablesView, boolean> = {
  categories: true,
  cashFlow: false,
  netWorth: false,
};

/**
 * The monthly tables behind the Statistics charts. It reads the same sources, ledger and account
 * and category picks as the Statistics screen, so a table cell is the number its donut shows for
 * that month, and a pick made in either holds in both. The period is its own (not the shared date
 * range, which it neither reads nor changes), held in a session store so a fold or a resize that
 * remounts the screen keeps it, and so does Back: a new push opens on the period last picked.
 */
const TablesScreen: FC<TablesScreenProps> = ({ route, navigation }) => {
  const { t } = useTranslation();
  // The live height of the large-title bar the table scrolls under, which the table keeps its
  // header row flush below; read here so the design system's table stays free of navigation. On
  // iOS 27 the bar minimizes natively while the table scrolls (on the Duo, 82 at rest and 24 at
  // the status bar), and react-native-screens reports the minimized height, so the header follows
  // it.
  const barInset = useAnimatedHeaderHeight();
  const scheme = useActiveColorScheme();
  // Visibility, not focus: in two panes the panes behind this screen are in view without being the
  // focused route, and this screen is the only one read while it shows.
  const isVisible = useIsScreenVisible();

  // A filter sheet is a native Modal that stays presented over another tab, so the controls are
  // mounted afresh, closed, each time the screen stops being shown.
  const [sheetGeneration, setSheetGeneration] = useState(0);
  useEffect(() => {
    if (!isVisible) {
      setSheetGeneration((generation) => generation + 1);
    }
  }, [isVisible]);

  const { selectedAccounts, selectedCategories, toggleAccount, toggleCategory } =
    useStatisticsFilterSelection();
  const { selectedPeriod, selectPeriod } = useTablesPeriodSelection();
  const now = useVisibleRefreshedNow(isVisible);
  const {
    accounts,
    holdings,
    transactions,
    categories,
    isReady,
    baseCurrency,
    defaultCategoryKey,
    rateTable,
    categoryByKey,
    filtered,
    priceBook,
    spanStart,
    transactionsFresh,
    historyRows,
    historyFresh,
  } = useStatisticsSources({ isVisible, now, selectedAccounts });

  // A screen opened before Statistics has no run to read, so it starts the one that fills the
  // rate history; one opened after a run that covers its span starts nothing and shares that run.
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

  const ledger = useSpendingLedger({
    transactions,
    holdings,
    accounts,
    shownHoldings: filtered.netWorthHoldings,
  });

  // What a row shows in the list behind a cell is what Home shows, so it needs the holdings' names
  // and types and the accounts' names, and re-reads the language when it changes.
  const rowContext = useMemo(() => rowContextOf(holdings, accounts, t), [holdings, accounts, t]);

  // The Duo unfolded in landscape: a side bar on a window with room for two panes. The vertical
  // bar is the system's own trait, the layout mode the app's own test for that room, so a folded
  // Duo (one page) and a portrait Duo (a bottom bar) keep the period in its own row. The mode is
  // the settled one: a pose change that shows the raw mode for one frame would move the period
  // field and close a Period sheet that is open.
  const verticalBarEdge = useVerticalBarEdge();
  const layoutMode = useSettledLayoutMode();
  const isPeriodBesideFilters = verticalBarEdge !== 'none' && layoutMode === 'columns';

  const periodOptions = useMemo(() => tablePeriodOptions(spanStart, now), [spanStart, now]);
  const period = resolveTablePeriod(selectedPeriod, periodOptions, now);
  const months = useMemo(() => monthsOfPeriod(period, spanStart, now), [period, spanStart, now]);
  const view = route.params?.view ?? 'categories';
  const hasCategoryFilter = HAS_CATEGORY_FILTER[view];

  // The category menu lists what the months spent on, so a table never offers a category it has
  // no cell for; a held pick that fell out of the period stays listed, checked. The pick excludes
  // by the same list, so it removes every row it does not cover, a row the period nets out too.
  const periodSlices = useMemo(
    () =>
      hasCategoryFilter
        ? categorySlicesOfMonths({
            ledger,
            months,
            categoryDisplay: categoryByKey,
            rateTable,
            baseCurrency,
            defaultCategoryKey,
            scheme,
          })
        : [],
    [
      hasCategoryFilter,
      months,
      ledger,
      categoryByKey,
      rateTable,
      baseCurrency,
      defaultCategoryKey,
      scheme,
    ],
  );

  const categoryOptions = useMemo(
    () =>
      buildCategoryOptions({
        slices: periodSlices,
        categories,
        categoryByKey,
        keptKeys: selectedCategories,
        scheme,
      }),
    [periodSlices, categories, categoryByKey, selectedCategories, scheme],
  );
  const visibleSelectedCategories = useMemo(
    () => visibleCategorySelection(selectedCategories, categoryByKey, periodSlices),
    [selectedCategories, categoryByKey, periodSlices],
  );
  const excludedCategories = useMemo(
    () => excludedCategoryKeysOf(periodSlices, visibleSelectedCategories),
    [periodSlices, visibleSelectedCategories],
  );

  const selectView = (next: TablesView): void => {
    navigation.setParams({ view: next });
  };

  // A form of this transaction can be open under this screen (in the second pane, or kept by a
  // fold). A second one would show the old values under the edited one, and a Save there would
  // write them back, so this screen closes and the one that is open shows as it was.
  const openTransaction = useCallback(
    (transactionId: string): void => {
      const isFormOpen = navigation
        .getState()
        .routes.some(
          ({ name, params }) =>
            name === 'TransactionForm' &&
            params !== undefined &&
            'transactionId' in params &&
            params.transactionId === transactionId,
        );

      if (isFormOpen) {
        navigation.goBack();
      } else {
        navigation.navigate('TransactionForm', { transactionId });
      }
    },
    [navigation],
  );

  if (!isReady) {
    // A scroll, so the bar's large title is tracked from the first frame and the spinner sits
    // below it, not under the translucent bar.
    return (
      <Screen scroll uncapped>
        <LoadingState testID="tables-loading" />
      </Screen>
    );
  }

  const viewLabels: Record<TablesView, string> = {
    categories: t('tables.view.categories'),
    cashFlow: t('tables.view.cashFlow'),
    netWorth: t('tables.view.netWorth'),
  };

  const periodField = (
    <TablePeriodField
      key={`period-${sheetGeneration}`}
      period={period}
      options={periodOptions}
      now={now}
      onSelect={selectPeriod}
      testID="tables-period"
    />
  );

  // They go into the table's scroll, so at a large type size they scroll away with the caption
  // and leave the rows the room; the empty state keeps them in place. The view switch is the
  // first of them, so it scrolls away too and the title collapses as on Home and Statistics.
  const controls = (
    <Box gap={3}>
      <SegmentedControl<TablesView>
        options={TABLES_VIEWS}
        selected={view}
        onSelect={selectView}
        labels={viewLabels}
        labelVariant="caption"
        accessibilityLabel={t('tables.view.label')}
        testID="tables-view"
      />

      <Box
        direction="row"
        gap={3}
        style={[styles.filterBar, isPeriodBesideFilters && styles.filterBarWithPeriod]}
        testID="tables-filter-bar"
      >
        {isPeriodBesideFilters && periodField}

        {isPeriodBesideFilters && (
          <Box style={styles.filterBarSpacer} testID="tables-filter-bar-spacer" />
        )}

        <FilterMenu
          key={`account-filter-${sheetGeneration}`}
          label={t('statistics.filterAccounts')}
          sheetTitle={t('statistics.filterAccountsSheetTitle')}
          testID="tables-account-filter"
          options={buildAccountOptions(filtered.optionAccounts, t, scheme)}
          selected={filtered.visibleSelectedAccounts}
          onToggle={toggleAccount}
          triggerIcon="tray"
        />

        {hasCategoryFilter && (
          <FilterMenu
            key={`category-filter-${sheetGeneration}`}
            label={t('statistics.filterCategories')}
            sheetTitle={t('statistics.filterCategoriesSheetTitle')}
            testID="tables-category-filter"
            options={categoryOptions}
            selected={visibleSelectedCategories}
            onToggle={toggleCategory}
            triggerIcon={genericEntitySymbol.category}
          />
        )}
      </Box>

      {!isPeriodBesideFilters && periodField}
    </Box>
  );

  return (
    // The table is the safe-area view's own child, so it is the scroll the large title collapses
    // with, and it pads its own sides and clears the tab bar.
    <Screen bleedTop>
      {match(view)
        .with('categories', () => (
          <CategoryTable
            ledger={ledger}
            months={months}
            now={now}
            categoryDisplay={categoryByKey}
            rateTable={rateTable}
            baseCurrency={baseCurrency}
            defaultCategoryKey={defaultCategoryKey}
            excludedCategories={excludedCategories}
            rowContext={rowContext}
            sheetGeneration={sheetGeneration}
            onOpenTransaction={openTransaction}
            topContent={controls}
            barInset={barInset}
          />
        ))
        .with('cashFlow', () => (
          <CashFlowTable
            ledger={ledger}
            months={months}
            now={now}
            categoryDisplay={categoryByKey}
            rateTable={rateTable}
            baseCurrency={baseCurrency}
            defaultCategoryKey={defaultCategoryKey}
            rowContext={rowContext}
            sheetGeneration={sheetGeneration}
            onOpenTransaction={openTransaction}
            topContent={controls}
            barInset={barInset}
          />
        ))
        .with('netWorth', () => (
          <NetWorthTable
            accounts={filtered.filteredAccounts}
            holdings={filtered.netWorthHoldings}
            transactions={transactions}
            historyRows={historyRows}
            months={months}
            now={now}
            rateTable={rateTable}
            priceBook={priceBook}
            baseCurrency={baseCurrency}
            backfillState={backfillStatus.state}
            topContent={controls}
            barInset={barInset}
          />
        ))
        .exhaustive()}
    </Screen>
  );
};

export default TablesScreen;
