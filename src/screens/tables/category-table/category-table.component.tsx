import { minOf } from '@kiko/numbers';
import { type FC, useMemo } from 'react';
import type { TFunction } from 'i18next';
import { Money } from '@kiko/currency/money';
import { useTranslation } from 'react-i18next';
import DataTable, {
  type DataTableCell,
  type DataTableColumn,
  type DataTableRow,
} from '@kiko/design-system/components/data-table';
import { formatMoney } from '@kiko/currency/format';
import Box from '@kiko/design-system/components/box';
import { activeLocale } from '@kiko/i18n/active-locale';
import type { Currency } from '@kiko/currency/currency';
import EmptyState from '@kiko/design-system/components/empty-state';
import { buildCategoryByMonth } from '@kiko/statistics/category-by-month';
import { averageOverComplete, firstCompleteMonthIndex } from '@kiko/statistics/table-period';

import { monthColumnLabel, monthTitle } from '../month-column-label';

import { styles } from './category-table.styles';
import type { CategoryTableProps } from './category-table.props';

const NO_VALUE = '–';
const WHOLE_UNITS = { fractionDigits: 0, symbol: false } as const;
// The table opens with this many month columns showing, the next column peeking in as the hint
// that it scrolls.
const OPENING_MONTHS_SHOWN = 3;

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

type Spoken = { baseCurrency: Currency; locale: string; t: TFunction };

const cellOf = (amount: number, label: string, spoken: Spoken): DataTableCell => {
  const money = Money.of(spoken.baseCurrency, amount);

  return {
    text: formatMoney(money, spoken.locale, WHOLE_UNITS),
    accessibilityLabel: label,
    // The cell shows whole units; the spoken value is the full amount.
    accessibilityValue: formatMoney(money, spoken.locale),
  };
};

const averageCellOf = (average: number | null, label: string, spoken: Spoken): DataTableCell => {
  if (average === null) {
    return {
      text: NO_VALUE,
      accessibilityLabel: label,
      accessibilityValue: spoken.t('tables.noCompleteMonth'),
    };
  }

  return cellOf(Math.round(average), label, spoken);
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
  const firstRowTime = useMemo(
    () => (ledger.shownRows.length === 0 ? null : minOf(ledger.shownRows.map((row) => row.time))),
    [ledger.shownRows],
  );

  const columns = useMemo<DataTableColumn[]>(
    () => [
      ...months.map((month, index) => ({
        key: `month-${month.start}`,
        header: monthColumnLabel(month, index === 0, t),
      })),
      { key: 'total', header: t('tables.total'), isSum: true },
      { key: 'average', header: t('tables.average'), isSum: true },
    ],
    [months, t],
  );

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
      initialColumnIndex={Math.max(months.length - OPENING_MONTHS_SHOWN, 0)}
      testID="category-table"
    />
  );
};

export default CategoryTable;
