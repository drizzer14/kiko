import { useMemo } from 'react';
import { ratesRepo } from '@kiko/rates/repo';
import { settingsRepo } from '@kiko/settings';
import { useDataReady, useLiveQuery } from '@kiko/db';
import { categoriesRepo } from '@kiko/categories/repo';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';
import { buildRateTable } from '@kiko/rates/net-worth-view';
import { useIsScreenVisible } from '@kiko/navigation/pane-stack';
import { recurringGroupsOf } from '@kiko/recurring/recurring-groups';
import { DEFAULT_CATEGORY_KEY } from '@kiko/categories/category-display';
import { compareText, type RecurringSeries } from '@kiko/recurring/detection';
import { useActiveColorScheme } from '@kiko/design-system/active-color-scheme';

const NO_GROUPS = { groups: [], total: undefined };

/**
 * The category groups of the recurring list and the total of all, for the `shown` series. The
 * charge rows come from a by-ids read of every series in `all` (a hidden one included), so a hide
 * changes no id: the query's sql and params stay equal and `useLiveQuery` reads nothing. A mark
 * that changes the series reads once more; a settings write runs only the one-row settings read,
 * never a whole-ledger read or detection. Each read is `paused` while the screen is hidden and
 * never `cached`, like `useRecurringSeries`. `isLoading` is true until all four reads settle, and
 * no group is built from a half-landed read.
 */
export const useRecurringGroups = (
  shown: readonly RecurringSeries[],
  all: readonly RecurringSeries[],
) => {
  const isVisible = useIsScreenVisible();
  const scheme = useActiveColorScheme();
  const liveOptions = { paused: !isVisible } as const;
  // The ids are the key, so one series order or another reads under one and the same query.
  const idsKey = JSON.stringify(
    [...new Set(all.flatMap(({ chargeIds }) => chargeIds))].sort(compareText),
  );
  const byIdsQuery = useMemo(
    () => transactionsRepo.listWithContextByIdsQuery(JSON.parse(idsKey)),
    [idsKey],
  );
  const { data: rows, isLoading: rowsLoading } = useLiveQuery(
    byIdsQuery,
    ['transactions', 'holdings', 'accounts'],
    true,
    liveOptions,
  );
  const { data: categories, isLoading: categoriesLoading } = useLiveQuery(
    categoriesRepo.allQuery(),
    ['categories'],
    true,
    liveOptions,
  );
  const { data: rates, isLoading: ratesLoading } = useLiveQuery(
    ratesRepo.allQuery(),
    ['currency_rates'],
    true,
    liveOptions,
  );
  const { data: settingsRows, isLoading: settingsLoading } = useLiveQuery(
    settingsRepo.getQuery(),
    ['settings'],
    true,
    liveOptions,
  );
  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const defaultCategoryKey = settingsRows.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;
  const rateTable = useMemo(() => buildRateTable(rates), [rates]);
  const isReady = useDataReady(rowsLoading, categoriesLoading, ratesLoading, settingsLoading);
  const { groups, total } = useMemo(
    () =>
      isReady
        ? recurringGroupsOf({
            shown,
            rows,
            categories,
            defaultCategoryKey,
            baseCurrency,
            rateTable,
            scheme,
          })
        : NO_GROUPS,
    [isReady, shown, rows, categories, defaultCategoryKey, baseCurrency, rateTable, scheme],
  );

  return { groups, total, isLoading: !isReady };
};
