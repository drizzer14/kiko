import { type FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DataTable, {
  type DataTableColumn,
  type DataTableRow,
} from '@kiko/design-system/components/data-table';
import Box from '@kiko/design-system/components/box';
import { activeLocale } from '@kiko/i18n/active-locale';
import type { ColorScheme } from '@kiko/design-system/palette';
import EmptyState from '@kiko/design-system/components/empty-state';
import { buildCategoryByMonth } from '@kiko/statistics/category-by-month';
import { averageOverComplete, firstCompleteMonthIndex } from '@kiko/statistics/table-period';

import {
  cellOf,
  columnsOf,
  firstRowTimeOf,
  averageCellOf,
  openingColumnIndexOf,
  type Spoken,
} from '../table-cells';
import { monthTitle } from '../month-column-label';

import { styles } from './category-table.styles';
import type { CategoryTableProps } from './category-table.props';

// The table keeps a row's key, title and amounts, never a slice color, so the scheme the breakdown
// resolves colors in cannot show here; the category menu's own slices take the active one.
const TABLE_SCHEME: ColorScheme = 'dark';

type Amounts = {
  key: string;
  label: string;
  isSummary?: boolean;
  /** One per month, in the base currency's minor units. */
  cells: number[];
  total: number;
  /** Null when no month is complete yet. */
  average: number | null;
};

const rowOf = (
  amounts: Amounts,
  months: CategoryTableProps['months'],
  spoken: Spoken,
): DataTableRow => ({
  key: amounts.key,
  label: amounts.label,
  isSummary: amounts.isSummary,
  cells: [
    ...amounts.cells.map((amount, index) =>
      cellOf(amount, `${amounts.label}, ${monthTitle(months[index], spoken.t)}`, spoken),
    ),
    cellOf(amounts.total, `${amounts.label}, ${spoken.t('tables.total')}`, spoken),
    averageCellOf(amounts.average, `${amounts.label}, ${spoken.t('tables.average')}`, spoken),
  ],
});

const CategoryTable: FC<CategoryTableProps> = ({
  ledger,
  months,
  now,
  categoryDisplay,
  rateTable,
  baseCurrency,
  defaultCategoryKey,
  excludedCategories,
  topContent,
}) => {
  const { t } = useTranslation();
  const locale = activeLocale();
  const currentIsPartial = (months.at(-1)?.end ?? 0) >= now;
  const table = useMemo(
    () =>
      buildCategoryByMonth({
        ledger,
        months,
        categoryDisplay,
        rateTable,
        baseCurrency,
        defaultCategoryKey,
        excludedCategories,
        scheme: TABLE_SCHEME,
      }),
    [
      ledger,
      months,
      categoryDisplay,
      rateTable,
      baseCurrency,
      defaultCategoryKey,
      excludedCategories,
    ],
  );
  const firstRowTime = useMemo(() => firstRowTimeOf(ledger), [ledger]);

  const columns = useMemo<DataTableColumn[]>(() => columnsOf(months, t), [months, t]);

  const rows = useMemo<DataTableRow[]>(() => {
    const spoken = { baseCurrency, locale, t };
    const firstCompleteIndex = firstCompleteMonthIndex(months, firstRowTime, now);
    const averageOf = (cells: number[]) =>
      averageOverComplete(cells, firstCompleteIndex, currentIsPartial);

    return [
      ...table.rows.map((row) =>
        rowOf(
          {
            key: `category-${row.key}`,
            label: row.title,
            cells: row.cells,
            total: row.total,
            average: averageOf(row.cells),
          },
          months,
          spoken,
        ),
      ),
      rowOf(
        {
          key: 'all',
          label: t('tables.all'),
          isSummary: true,
          cells: table.allCells,
          total: table.allTotal,
          average: averageOf(table.allCells),
        },
        months,
        spoken,
      ),
    ];
  }, [table, months, firstRowTime, now, currentIsPartial, baseCurrency, locale, t]);

  const caption = t('tables.category.caption', { currency: baseCurrency });
  // The empty state goes through the table, so the controls above it are one mounted tree whether
  // the table has rows or not: a filter sheet open in them survives a pick that empties the table.
  const emptyContent =
    table.rows.length === 0 ? (
      <Box style={styles.empty}>
        <EmptyState
          icon="tablecells"
          title={t('tables.empty.title')}
          message={t('tables.empty.message')}
          testID="category-table-empty"
        />
      </Box>
    ) : undefined;

  return (
    <DataTable
      columns={columns}
      rows={rows}
      caption={currentIsPartial ? `${caption} ${t('tables.category.partialMonth')}` : caption}
      topContent={topContent}
      emptyContent={emptyContent}
      initialColumnIndex={openingColumnIndexOf(months)}
      testID="category-table"
    />
  );
};

export default CategoryTable;
