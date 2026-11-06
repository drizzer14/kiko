import { type FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DataTable, {
  type DataTableCell,
  type DataTableColumn,
  type DataTableRow,
} from '@kiko/design-system/components/data-table';
import Box from '@kiko/design-system/components/box';
import { activeLocale } from '@kiko/i18n/active-locale';
import EmptyState from '@kiko/design-system/components/empty-state';
import { firstCompleteMonthIndex } from '@kiko/statistics/table-period';
import { buildCashFlow, type CashFlowLine } from '@kiko/statistics/cash-flow';

import {
  cellOf,
  columnsOf,
  dashCellOf,
  firstRowTimeOf,
  averageCellOf,
  openingColumnIndexOf,
  type Spoken,
} from '../table-cells';
import { monthTitle } from '../month-column-label';

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

const lineRowOf = (
  line: Line,
  months: CashFlowTableProps['months'],
  spoken: Spoken,
): DataTableRow => ({
  key: line.key,
  label: line.label,
  isSummary: line.isSummary,
  cells: [
    ...line.cells.map((amount, index) =>
      cellOf(amount, `${line.label}, ${monthTitle(months[index], spoken.t)}`, spoken),
    ),
    cellOf(line.total, `${line.label}, ${spoken.t('tables.total')}`, spoken),
    averageCellOf(line.average, `${line.label}, ${spoken.t('tables.average')}`, spoken),
  ],
});

const CashFlowTable: FC<CashFlowTableProps> = ({
  ledger,
  months,
  now,
  categoryDisplay,
  rateTable,
  baseCurrency,
  defaultCategoryKey,
  topContent,
}) => {
  const { t } = useTranslation();
  const locale = activeLocale();
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
      lineRowOf({ key: 'income', label: t('tables.cashFlow.income'), ...income }, months, spoken),
      lineRowOf(
        { key: 'expenses', label: t('tables.cashFlow.expenses'), ...expenses },
        months,
        spoken,
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
  }, [flow, months, baseCurrency, locale, t]);

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
    <DataTable
      columns={columns}
      rows={rows}
      caption={currentIsPartial ? `${caption} ${t('tables.cashFlow.partialMonth')}` : caption}
      topContent={topContent}
      emptyContent={emptyContent}
      initialColumnIndex={openingColumnIndexOf(months)}
      testID="cash-flow-table"
    />
  );
};

export default CashFlowTable;
