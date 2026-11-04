import {
  monthsOfPeriod,
  resolveTablePeriod,
  type TablePeriod,
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
import Screen from '@kiko/design-system/components/screen';
import type { TablesParams } from '@kiko/navigation/types';
import { type FC, useEffect, useMemo, useState } from 'react';
import { useIsScreenVisible } from '@kiko/navigation/pane-stack';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import FilterMenu from '@kiko/design-system/components/filter-menu';
import LoadingState from '@kiko/design-system/components/loading-state';
import { useStatisticsSources } from '@kiko/statistics/statistics-sources';
import { buildCategoryBreakdown } from '@kiko/statistics/category-breakdown';
import { spendingRowsIn, useSpendingLedger } from '@kiko/statistics/spending-ledger';
import { useVisibleRefreshedNow } from '@kiko/design-system/use-visible-refreshed-now';
import { useStatisticsFilterSelection } from '@kiko/design-system/use-statistics-filter-selection';

import { styles } from './tables.styles';
import CategoryTable from './category-table';
import TablePeriodField from './table-period-field';

// This screen is registered in the Home and the Statistics stacks (the Statistics screen that
// opens it shows in either), so it binds no stack's param list: it needs the route's params and
// `setParams`, which both stacks' generated props satisfy.
type TablesScreenProps = {
  route: { params?: TablesParams };
  navigation: { setParams: (params: TablesParams) => void };
};

/**
 * The monthly tables behind the Statistics charts. It reads the same sources, ledger and account
 * and category picks as the Statistics screen, so a table cell is the number its donut shows for
 * that month, and a pick made in either holds in both. The period is its own, held in the route
 * params (not in the shared date range, which it neither reads nor changes), so a fold or a
 * resize that remounts the screen keeps it, and a new push opens on the last 12 months.
 */
const TablesScreen: FC<TablesScreenProps> = ({ route, navigation }) => {
  const { t } = useTranslation();
  // Visibility, not focus: in two panes this screen is on screen without being the focused route.
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
    spanStart,
  } = useStatisticsSources({ isVisible, now, selectedAccounts });
  const ledger = useSpendingLedger({
    transactions,
    holdings,
    accounts,
    shownHoldings: filtered.netWorthHoldings,
  });

  const periodOptions = useMemo(() => tablePeriodOptions(spanStart, now), [spanStart, now]);
  const period = resolveTablePeriod(route.params?.period, periodOptions);
  const months = useMemo(() => monthsOfPeriod(period, spanStart, now), [period, spanStart, now]);

  // The category menu lists what the period spent on, so a month's table never offers a category
  // it has no cell for; a held pick that fell out of the period stays listed, checked.
  const periodSlices = useMemo(() => {
    const first = months.at(0);
    const last = months.at(-1);

    if (first === undefined || last === undefined) {
      return [];
    }

    return buildCategoryBreakdown({
      transactions: spendingRowsIn(ledger, first.start, last.end),
      categoryDisplay: categoryByKey,
      rateTable,
      baseCurrency,
      defaultCategoryKey,
      excludedTransactionIds: ledger.excludedTransactionIds,
    });
  }, [months, ledger, categoryByKey, rateTable, baseCurrency, defaultCategoryKey]);

  const categoryOptions = useMemo(
    () =>
      buildCategoryOptions({
        slices: periodSlices,
        categories,
        categoryByKey,
        keptKeys: selectedCategories,
      }),
    [periodSlices, categories, categoryByKey, selectedCategories],
  );
  const visibleSelectedCategories = useMemo(
    () => visibleCategorySelection(selectedCategories, categoryByKey, periodSlices),
    [selectedCategories, categoryByKey, periodSlices],
  );
  const excludedCategories = useMemo(
    () => excludedCategoryKeysOf(periodSlices, visibleSelectedCategories),
    [periodSlices, visibleSelectedCategories],
  );

  const selectPeriod = (next: TablePeriod): void => {
    navigation.setParams({ period: next });
  };

  if (!isReady) {
    return (
      <Screen belowHeader>
        <LoadingState testID="tables-loading" />
      </Screen>
    );
  }

  // They go into the table's scroll, so at a large type size they scroll away with the caption
  // and leave the rows the room; the empty state keeps them in place.
  const controls = (
    <Box gap={3}>
      <Box direction="row" gap={3} style={styles.filterBar}>
        <FilterMenu
          key={`account-filter-${sheetGeneration}`}
          label={t('statistics.filterAccounts')}
          sheetTitle={t('statistics.filterAccountsSheetTitle')}
          testID="tables-account-filter"
          options={buildAccountOptions(filtered.optionAccounts, t)}
          selected={filtered.visibleSelectedAccounts}
          onToggle={toggleAccount}
          triggerIcon="tray"
        />

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
      </Box>

      <TablePeriodField
        key={`period-${sheetGeneration}`}
        period={period}
        options={periodOptions}
        onSelect={selectPeriod}
        testID="tables-period"
      />
    </Box>
  );

  return (
    <Screen belowHeader>
      <Box gap={3} style={styles.content}>
        <CategoryTable
          ledger={ledger}
          months={months}
          now={now}
          categoryDisplay={categoryByKey}
          rateTable={rateTable}
          baseCurrency={baseCurrency}
          defaultCategoryKey={defaultCategoryKey}
          excludedCategories={excludedCategories}
          topContent={controls}
        />
      </Box>
    </Screen>
  );
};

export default TablesScreen;
