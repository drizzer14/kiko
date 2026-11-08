import { match } from 'ts-pattern';
import { useTranslation } from 'react-i18next';
import DataTable, {
  type DataTableColumn,
  type DataTableRow,
} from '@kiko/design-system/components/data-table';
import Box from '@kiko/design-system/components/box';
import { type FC, useCallback, useMemo } from 'react';
import { activeLocale } from '@kiko/i18n/active-locale';
import type { ColorScheme } from '@kiko/design-system/palette';
import EmptyState from '@kiko/design-system/components/empty-state';
import { buildCategoryByMonth } from '@kiko/statistics/category-by-month';
import { type CellRange, expenseRowsOf } from '@kiko/statistics/cell-rows';
import { averageOverComplete, firstCompleteMonthIndex } from '@kiko/statistics/table-period';

import {
  columnsOf,
  periodOf,
  firstRowTimeOf,
  averageCellOf,
  openingCellOf,
  openingColumnIndexOf,
  type Spoken,
} from '../table-cells';
import { monthTitle } from '../month-column-label';
import CellRowsSheet, { useCellRowsSheet } from '../cell-rows-sheet';

import { styles } from './category-table.styles';
import type { CategoryTableProps } from './category-table.props';

// The table keeps a row's key, title and amounts, never a slice color, so the scheme the breakdown
// resolves colors in cannot show here; the category menu's own slices take the active one.
const TABLE_SCHEME: ColorScheme = 'dark';

/** Which rows a cell opens: a category's, or the All row's, which a held pick narrows. */
type CellSelector = { kind: 'category'; key: string } | { kind: 'all' };

type Amounts = {
  key: string;
  label: string;
  isSummary?: boolean;
  /** One per month, in the base currency's minor units. */
  cells: number[];
  total: number;
  /** Null when no month is complete yet. */
  average: number | null;
  selector: CellSelector;
};

const rowOf = (
  amounts: Amounts,
  months: CategoryTableProps['months'],
  spoken: Spoken,
  open: (title: string, selector: CellSelector, range: CellRange) => void,
): DataTableRow => {
  const totalLabel = `${amounts.label}, ${spoken.t('tables.total')}`;

  return {
    key: amounts.key,
    label: amounts.label,
    isSummary: amounts.isSummary,
    cells: [
      ...amounts.cells.map((amount, index) => {
        const label = `${amounts.label}, ${monthTitle(months[index], spoken.t)}`;

        return openingCellOf(amount, label, spoken, () =>
          open(label, amounts.selector, months[index]),
        );
      }),
      openingCellOf(amounts.total, totalLabel, spoken, () =>
        open(totalLabel, amounts.selector, periodOf(months)),
      ),
      averageCellOf(amounts.average, `${amounts.label}, ${spoken.t('tables.average')}`, spoken),
    ],
  };
};

const CategoryTable: FC<CategoryTableProps> = ({
  ledger,
  months,
  now,
  categoryDisplay,
  rateTable,
  baseCurrency,
  defaultCategoryKey,
  excludedCategories,
  describeRow,
  sheetGeneration,
  onOpenTransaction,
  topContent,
}) => {
  const { t } = useTranslation();
  const locale = activeLocale();
  // The sheet computes its rows from this, in render, so it reads the ledger and rates as they are
  // now, not as they were at the tap. The All cell adds the rows of the categories the table was
  // built with, so it takes the same held pick.
  const rowsOf = useCallback(
    (selector: CellSelector, range: CellRange) => {
      const display = {
        categoryDisplay,
        rateTable,
        baseCurrency,
        defaultCategoryKey,
        describe: describeRow,
      };

      return match(selector)
        .with({ kind: 'all' }, () => expenseRowsOf(ledger, range, { excludedCategories }, display))
        .with({ kind: 'category' }, ({ key }) =>
          expenseRowsOf(ledger, range, { categoryKey: key }, display),
        )
        .exhaustive();
    },
    [
      ledger,
      categoryDisplay,
      rateTable,
      baseCurrency,
      defaultCategoryKey,
      excludedCategories,
      describeRow,
    ],
  );
  const { open, sheet } = useCellRowsSheet(sheetGeneration, rowsOf, onOpenTransaction);
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
            selector: { kind: 'category', key: row.key },
          },
          months,
          spoken,
          open,
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
          selector: { kind: 'all' },
        },
        months,
        spoken,
        open,
      ),
    ];
  }, [table, months, firstRowTime, now, currentIsPartial, baseCurrency, locale, t, open]);

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
    <>
      <DataTable
        columns={columns}
        rows={rows}
        caption={currentIsPartial ? `${caption} ${t('tables.category.partialMonth')}` : caption}
        topContent={topContent}
        emptyContent={emptyContent}
        initialColumnIndex={openingColumnIndexOf(months)}
        testID="category-table"
      />

      {sheet !== undefined && (
        <CellRowsSheet
          key={`cell-rows-${sheetGeneration}`}
          {...sheet}
          baseCurrency={baseCurrency}
        />
      )}
    </>
  );
};

export default CategoryTable;
