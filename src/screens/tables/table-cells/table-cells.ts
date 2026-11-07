import { minOf } from '@kiko/numbers';
import type { TFunction } from 'i18next';
import { Money } from '@kiko/currency/money';
import type { CalendarMonth } from '@kiko/dates';
import { formatMoney } from '@kiko/currency/format';
import type { Currency } from '@kiko/currency/currency';
import type { SpendingLedger } from '@kiko/statistics/spending-ledger';
import type { DataTableCell, DataTableColumn } from '@kiko/design-system/components/data-table';

import { monthColumnLabel } from '../month-column-label';

const NO_VALUE = '–';
// The sign `formatMoney` writes before a negative amount, whatever the locale.
const MINUS = '-';
const WHOLE_UNITS = { fractionDigits: 0, symbol: false } as const;
// A table opens with this many month columns showing, the next column peeking in as the hint that
// it scrolls.
const OPENING_MONTHS_SHOWN = 3;

export type Spoken = { baseCurrency: Currency; locale: string; t: TFunction };

/**
 * A money cell: whole units shown, the full amount spoken. It is marked negative only when the
 * whole units shown are, so a cell that reads "0" is never marked.
 */
export const cellOf = (amount: number, label: string, spoken: Spoken): DataTableCell => {
  const money = Money.of(spoken.baseCurrency, amount);
  const text = formatMoney(money, spoken.locale, WHOLE_UNITS);

  return {
    text,
    accessibilityLabel: label,
    // The cell shows whole units; the spoken value is the full amount.
    accessibilityValue: formatMoney(money, spoken.locale),
    // The sign is read off the shown text: `formatMoney` alone decides how a half unit rounds, and
    // it writes no sign on a zero, so the mark can never disagree with what the cell reads.
    ...(text.startsWith(MINUS) ? { tone: 'negative' as const } : {}),
  };
};

/** A dash for a value there is none of, with a word for VoiceOver instead of silence. */
export const dashCellOf = (label: string, spokenValue: string): DataTableCell => ({
  text: NO_VALUE,
  accessibilityLabel: label,
  accessibilityValue: spokenValue,
});

export const averageCellOf = (
  average: number | null,
  label: string,
  spoken: Spoken,
): DataTableCell =>
  average === null
    ? dashCellOf(label, spoken.t('tables.noCompleteMonth'))
    : cellOf(Math.round(average), label, spoken);

/** A column per month. */
export const monthColumnsOf = (months: readonly CalendarMonth[], t: TFunction): DataTableColumn[] =>
  months.map((month, index) => ({
    key: `month-${month.start}`,
    header: monthColumnLabel(month, index === 0, t),
  }));

/** A column per month, then the two sums. */
export const columnsOf = (months: readonly CalendarMonth[], t: TFunction): DataTableColumn[] => [
  ...monthColumnsOf(months, t),
  { key: 'total', header: t('tables.total'), isSum: true },
  { key: 'average', header: t('tables.average'), isSum: true },
];

export const openingColumnIndexOf = (months: readonly CalendarMonth[]): number =>
  Math.max(months.length - OPENING_MONTHS_SHOWN, 0);

/** The time of the first row the table can show; null with none. */
export const firstRowTimeOf = (ledger: SpendingLedger): number | null =>
  ledger.shownRows.length === 0 ? null : minOf(ledger.shownRows.map((row) => row.time));
