import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import DataTable, {
  type DataTableCell,
  type DataTableColumn,
  type DataTableRow,
} from '@kiko/design-system/components/data-table';
import Box from '@kiko/design-system/components/box';
import { type FC, useCallback, useMemo } from 'react';
import { activeLocale } from '@kiko/i18n/active-locale';
import EmptyState from '@kiko/design-system/components/empty-state';
import { firstCompleteMonthIndex } from '@kiko/statistics/table-period';
import { buildCashFlow, type CashFlowLine } from '@kiko/statistics/cash-flow';
import { type CellRange, expenseRowsOf, incomeRowsOf } from '@kiko/statistics/cell-rows';

import {
  cellOf,
  periodOf,
  columnsOf,
  dashCellOf,
  firstRowTimeOf,
  averageCellOf,
  openingCellOf,
  openingColumnIndexOf,
  type Spoken,
} from '../table-cells';
import { monthTitle } from '../month-column-label';
import CellRowsSheet, { useCellRowsSheet } from '../cell-rows-sheet';

import { styles } from './cash-flow-table.styles';
import type { CashFlowTableProps } from './cash-flow-table.props';

const PERCENT = 100;
const WHOLE_PERCENT_DIGITS = 0;
const SPOKEN_PERCENT_DIGITS = 1;

/** A rate as a percent; adding zero turns a rounded negative zero into zero. */
const percentOf = (rate: number, fractionDigits: number): number =>
  Number((rate * PERCENT).toFixed(fractionDigits)) + 0;

const percentTextOf = (percent: number, locale: string, fractionDigits: number): string =>
  `${percent.toLocaleString(locale, { maximumFractionDigits: fractionDigits })}%`;

/** `unknown` is what VoiceOver reads for the dash, which stands for a rate with no income. */
const rateCellOf = (
  rate: number | null,
  label: string,
  spoken: Spoken,
  unknown: string,
): DataTableCell => {
  if (rate === null) {
    return dashCellOf(label, unknown);
  }

  const shown = percentOf(rate, WHOLE_PERCENT_DIGITS);

  return {
    text: percentTextOf(shown, spoken.locale, WHOLE_PERCENT_DIGITS),
    accessibilityLabel: label,
    // The cell shows a whole percent; the spoken value keeps its decimals.
    accessibilityValue: percentTextOf(
      percentOf(rate, SPOKEN_PERCENT_DIGITS),
      spoken.locale,
      SPOKEN_PERCENT_DIGITS,
    ),
    ...(shown < 0 ? { tone: 'negative' as const } : {}),
  };
};

type Line = CashFlowLine & { key: string; label: string; isSummary?: boolean };

/** The lines whose cells open the rows behind them: the two that are sums of rows. */
type CellSelector = 'income' | 'expenses';

/** Which rows the month and Total cells of a line open, and where to show them. */
type Opening = {
  selector: CellSelector;
  open: (title: string, selector: CellSelector, range: CellRange) => void;
};

// Net and the savings rate are computed from the other lines, with no rows behind them, so a
// line with no `opening` has plain cells.
const lineRowOf = (
  line: Line,
  months: CashFlowTableProps['months'],
  spoken: Spoken,
  opening?: Opening,
): DataTableRow => {
  const cellAt = (amount: number, label: string, range: () => CellRange): DataTableCell =>
    foldMap(maybe(opening), ({ selector, open }) =>
      openingCellOf(amount, label, spoken, () => open(label, selector, range())),
    ) ?? cellOf(amount, label, spoken);

  return {
    key: line.key,
    label: line.label,
    isSummary: line.isSummary,
    cells: [
      ...line.cells.map((amount, index) =>
        cellAt(
          amount,
          `${line.label}, ${monthTitle(months[index], spoken.t)}`,
          () => months[index],
        ),
      ),
      cellAt(line.total, `${line.label}, ${spoken.t('tables.total')}`, () => periodOf(months)),
      averageCellOf(line.average, `${line.label}, ${spoken.t('tables.average')}`, spoken),
    ],
  };
};

const CashFlowTable: FC<CashFlowTableProps> = ({
  ledger,
  months,
  now,
  categoryDisplay,
  rateTable,
  baseCurrency,
  defaultCategoryKey,
  rowContext,
  sheetGeneration,
  onOpenTransaction,
  topContent,
  barInset,
}) => {
  const { t } = useTranslation();
  const locale = activeLocale();
  // The sheet computes its rows from this, in render, so it reads the ledger and rates as they are
  // now, not as they were at the tap. A category pick never changes the cash flow, so the
  // expenses' rows take none.
  const rowsOf = useCallback(
    (selector: CellSelector, range: CellRange) =>
      match(selector)
        .with('income', () => incomeRowsOf(ledger, range, rateTable, baseCurrency, rowContext))
        .with('expenses', () =>
          expenseRowsOf(
            ledger,
            range,
            {},
            { categoryDisplay, rateTable, baseCurrency, defaultCategoryKey, context: rowContext },
          ),
        )
        .exhaustive(),
    [ledger, rateTable, baseCurrency, categoryDisplay, defaultCategoryKey, rowContext],
  );
  const { open, sheet } = useCellRowsSheet(sheetGeneration, rowsOf, onOpenTransaction);
  const currentIsPartial = (months.at(-1)?.end ?? 0) >= now;
  const firstRowTime = useMemo(() => firstRowTimeOf(ledger), [ledger]);
  const flow = useMemo(
    () =>
      buildCashFlow({
        ledger,
        months,
        rateTable,
        baseCurrency,
        categoryDisplay,
        defaultCategoryKey,
        firstCompleteIndex: firstCompleteMonthIndex(months, firstRowTime, now),
        currentIsPartial,
      }),
    [
      ledger,
      months,
      rateTable,
      baseCurrency,
      categoryDisplay,
      defaultCategoryKey,
      firstRowTime,
      now,
      currentIsPartial,
    ],
  );

  const columns = useMemo<DataTableColumn[]>(() => columnsOf(months, t), [months, t]);

  const rows = useMemo<DataTableRow[]>(() => {
    const spoken = { baseCurrency, locale, t };
    const { income, expenses, net, savingsRate } = flow;
    const noRate = t('tables.cashFlow.savingsRateUnknown');
    const rateLabel = t('tables.cashFlow.savingsRate');
    // A dash in the Average is a month count when no month is complete, and no income otherwise.
    const noAverage = income.average === null ? t('tables.noCompleteMonth') : noRate;

    return [
      lineRowOf({ key: 'income', label: t('tables.cashFlow.income'), ...income }, months, spoken, {
        selector: 'income',
        open,
      }),
      lineRowOf(
        { key: 'expenses', label: t('tables.cashFlow.expenses'), ...expenses },
        months,
        spoken,
        { selector: 'expenses', open },
      ),
      lineRowOf(
        { key: 'net', label: t('tables.cashFlow.net'), isSummary: true, ...net },
        months,
        spoken,
      ),
      {
        key: 'savings-rate',
        label: rateLabel,
        cells: [
          ...savingsRate.cells.map((rate, index) =>
            rateCellOf(rate, `${rateLabel}, ${monthTitle(months[index], t)}`, spoken, noRate),
          ),
          rateCellOf(savingsRate.total, `${rateLabel}, ${t('tables.total')}`, spoken, noRate),
          rateCellOf(
            savingsRate.average,
            `${rateLabel}, ${t('tables.average')}`,
            spoken,
            noAverage,
          ),
        ],
      },
    ];
  }, [flow, months, baseCurrency, locale, t, open]);

  const hasMoney = [...flow.income.cells, ...flow.expenses.cells].some((cell) => cell !== 0);
  const caption = t('tables.cashFlow.caption', { currency: baseCurrency });
  // The empty state goes through the table, so the controls above it stay one mounted tree: a
  // filter sheet open in them survives a pick that empties the table.
  const emptyContent = hasMoney ? undefined : (
    <Box style={styles.empty}>
      <EmptyState
        icon="tablecells"
        title={t('tables.cashFlow.empty.title')}
        message={t('tables.cashFlow.empty.message')}
        testID="cash-flow-table-empty"
      />
    </Box>
  );

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        caption={currentIsPartial ? `${caption} ${t('tables.cashFlow.partialMonth')}` : caption}
        topContent={topContent}
        emptyContent={emptyContent}
        initialColumnIndex={openingColumnIndexOf(months)}
        barInset={barInset}
        testID="cash-flow-table"
      />

      {sheet !== undefined && (
        <CellRowsSheet
          key={`cell-rows-${sheetGeneration}`}
          {...sheet}
          baseCurrency={baseCurrency}
          categoryDisplay={categoryDisplay}
          defaultCategoryKey={defaultCategoryKey}
        />
      )}
    </>
  );
};

export default CashFlowTable;
