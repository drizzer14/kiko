import {
  type RecurringMark,
  type RecurringPeriod,
  type RecurringSeries,
  chargeGroupsOf,
  seriesOfGroups,
} from '@kiko/recurring/detection';
import {
  type MarkedEntry,
  type MarkedChain,
  markedSeriesOf,
  detectedBesideMarked,
} from '@kiko/recurring/marked-series';
import maybe, { foldMap } from 'fnts/maybe';
import type { Currency } from '@kiko/currency/currency';
import { merchantNameOf } from '@kiko/transactions/merchant-name';
import { RECURRING_PERIODS } from '@kiko/recurring/recurring-periods';

import {
  type Ledger,
  type LedgerRow,
  type ExpectedSeries,
  dayViewsOf,
  viewsOf,
  expectedViewsOf,
} from './recurring-ledger';

type Random = () => number;

export type MarkSpec = [
  period: RecurringPeriod,
  amount: number,
  currency?: Currency,
  // The id of the row the mark was tapped on; a mark without it is one written before.
  transactionId?: string,
];
export type ExpectedShown = ExpectedSeries & {
  isMarked: boolean;
  // Minor units of the stored amounts a marked series holds.
  markAmounts?: number[];
  // Major units.
  lastAmount?: number;
};
export type ExpectedChain = { period: RecurringPeriod; amounts: number[]; currency?: Currency };
export type Outcome = {
  detected: RecurringSeries[];
  marked: RecurringSeries[];
  withoutCharges: MarkedChain[];
  // The marked series, then the detected ones that share no row with them.
  shown: RecurringSeries[];
};

const MINOR_UNITS_PER_MAJOR = 100;
const MIN_RANDOM_AMOUNT = 50;
const MAX_RANDOM_AMOUNT = 900;
const REAL_AMOUNT_SHARE = 0.7;
const SINGLE_MARK_SHARE = 0.5;
const GHOST_SHARE = 0.25;
const MAX_EXTRA_KEYS = 2;
const MAX_EXTRA_MARKS = 2;

export const outcomeOf = (
  ledger: Ledger,
  entries: readonly MarkedEntry[],
  now: number,
): Outcome => {
  const groups = chargeGroupsOf(ledger, now);
  const detected = seriesOfGroups(groups, now);
  const { series: marked, withoutCharges } = markedSeriesOf(groups, entries, now);

  return {
    detected,
    marked,
    withoutCharges,
    shown: [...marked, ...detectedBesideMarked(detected, marked)],
  };
};

const markOf = ([period, amount, currency = 'UAH', transactionId]: MarkSpec): RecurringMark => ({
  currency,
  amountMinorUnits: Math.round(amount * MINOR_UNITS_PER_MAJOR),
  period,
  ...foldMap(maybe(transactionId), (id) => ({ transactionId: id })),
});

export const entryOf = (name: string, marks: readonly MarkSpec[]): MarkedEntry => ({
  key: merchantNameOf(name).key,
  name,
  marks: marks.map(markOf),
});

const ascending = (left: number, right: number): number => left - right;

const compareText = (left: string, right: string): number =>
  Number(left > right) - Number(left < right);

const markAmountsOf = (series: RecurringSeries): number[] =>
  (series.marks ?? []).map(({ amountMinorUnits }) => amountMinorUnits).sort(ascending);

type Sortable = { from: string; period: string; count: number; isMarked: boolean };

const compareSortable = (left: Sortable, right: Sortable): number =>
  compareText(left.from, right.from) ||
  compareText(left.period, right.period) ||
  left.count - right.count ||
  Number(left.isMarked) - Number(right.isMarked);

/** What a shown series reads as; an unmarked one holds no marks. */
export const shownViewsOf = (series: readonly RecurringSeries[]) =>
  series
    .flatMap((entry) =>
      viewsOf([entry]).map((view) => ({
        ...view,
        isMarked: entry.marks !== undefined,
        markAmounts: markAmountsOf(entry),
        lastChargeAmount: entry.lastChargeAmountMinorUnits / MINOR_UNITS_PER_MAJOR,
      })),
    )
    .sort(compareSortable);

/** The same on local days, so builds in two device zones compare. */
export const shownDayViewsOf = (series: readonly RecurringSeries[]) =>
  series
    .flatMap((entry) =>
      dayViewsOf([entry]).map((view) => ({
        ...view,
        isMarked: entry.marks !== undefined,
        markAmounts: markAmountsOf(entry),
      })),
    )
    .sort(compareSortable);

export const expectedShownViewsOf = (expected: readonly ExpectedShown[]) =>
  [...expected]
    .sort((left, right) =>
      compareSortable({ ...left, from: left.from ?? '' }, { ...right, from: right.from ?? '' }),
    )
    .flatMap((entry) =>
      expectedViewsOf([entry]).map((view) => ({
        ...view,
        isMarked: entry.isMarked,
        markAmounts: entry.markAmounts ?? expect.any(Array),
        lastChargeAmount: entry.lastAmount ?? expect.any(Number),
      })),
    );

const byCurrencyThenAmount = (
  left: { currency: string; amounts: number[] },
  right: { currency: string; amounts: number[] },
): number =>
  compareText(left.currency, right.currency) ||
  ascending(left.amounts[0] ?? 0, right.amounts[0] ?? 0);

export const chainViewsOf = (chains: readonly MarkedChain[]) =>
  chains
    .map(({ currency, period, marks }) => ({
      currency,
      period,
      amounts: marks.map(({ amountMinorUnits }) => amountMinorUnits).sort(ascending),
    }))
    .sort(byCurrencyThenAmount);

export const expectedChainViewsOf = (expected: readonly ExpectedChain[]) =>
  expected
    .map(({ period, amounts, currency = 'UAH' }) => ({
      currency,
      period,
      amounts: amounts.map((amount) => Math.round(amount * MINOR_UNITS_PER_MAJOR)).sort(ascending),
    }))
    .sort(byCurrencyThenAmount);

const between = (random: Random, low: number, high: number): number =>
  low + Math.floor(random() * (high - low + 1));

const pickFrom = <Entry>(random: Random, entries: readonly Entry[]): Entry =>
  entries[between(random, 0, entries.length - 1)] as Entry;

const currencyOfHolding = (ledger: Ledger, holdingId: string): Currency =>
  foldMap(maybe(ledger.holdings.find(({ id }) => id === holdingId)), ({ currency }) => currency) ??
  'UAH';

const markOfRow = (ledger: Ledger, row: LedgerRow, random: Random): RecurringMark => ({
  currency: currencyOfHolding(ledger, row.holdingId),
  amountMinorUnits: -row.amountMinorUnits,
  period: pickFrom(random, RECURRING_PERIODS),
});

const randomMark = (ledger: Ledger, rows: readonly LedgerRow[], random: Random): RecurringMark =>
  random() < REAL_AMOUNT_SHARE
    ? markOfRow(ledger, pickFrom(random, rows), random)
    : {
        currency: pickFrom(random, ['UAH', 'USD'] as const),
        amountMinorUnits:
          between(random, MIN_RANDOM_AMOUNT, MAX_RANDOM_AMOUNT) * MINOR_UNITS_PER_MAJOR,
        period: pickFrom(random, RECURRING_PERIODS),
      };

const distinctMarks = (marks: readonly RecurringMark[]): RecurringMark[] => [
  ...new Map(marks.map((mark) => [`${mark.currency}:${mark.amountMinorUnits}`, mark])).values(),
];

const rowsByKeyOf = (rows: readonly LedgerRow[]): Map<string, LedgerRow[]> => {
  const rowsByKey = new Map<string, LedgerRow[]>();

  for (const row of rows) {
    const key = merchantNameOf(row.description).key;

    rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), row]);
  }

  return rowsByKey;
};

/**
 * Entries over a random ledger. The first entry's first mark sits on a charge of a detected
 * series, so a mark reaches that series; the rest are real amounts, random ones, and a key with
 * no row at all.
 */
export const randomEntriesOf = (
  ledger: Ledger,
  detected: readonly RecurringSeries[],
  random: Random,
): MarkedEntry[] => {
  const debits = ledger.rows.filter((row) => row.amountMinorUnits < 0);
  const rowsByKey = rowsByKeyOf(debits);
  const anchorRows = detected.flatMap(({ chargeIds }) =>
    debits.filter((row) => chargeIds.includes(row.id)),
  );
  const anchorRow = anchorRows.length === 0 ? undefined : pickFrom(random, anchorRows);
  const keys = [...rowsByKey.keys()].sort();
  const firstKey =
    foldMap(maybe(anchorRow), ({ description }) => merchantNameOf(description).key) ??
    pickFrom(random, keys);
  const otherKeys = Array.from({ length: between(random, 0, MAX_EXTRA_KEYS) }, () =>
    pickFrom(random, keys),
  ).filter((key) => key !== firstKey);

  const entries = [...new Set([firstKey, ...otherKeys])].map((key, index): MarkedEntry => {
    const rows = rowsByKey.get(key) ?? [];
    const leading =
      index === 0 && anchorRow !== undefined
        ? markOfRow(ledger, anchorRow, random)
        : randomMark(ledger, rows, random);
    const extraCount = random() < SINGLE_MARK_SHARE ? 0 : between(random, 1, MAX_EXTRA_MARKS);
    const extras = Array.from({ length: extraCount }, () => randomMark(ledger, rows, random));

    return {
      key,
      name: rows[0]?.description ?? key,
      marks: distinctMarks([leading, ...extras]),
    };
  });

  return random() < GHOST_SHARE
    ? [
        ...entries,
        entryOf('Ghost Shop', [[pickFrom(random, RECURRING_PERIODS), MIN_RANDOM_AMOUNT]]),
      ]
    : entries;
};
