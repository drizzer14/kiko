// Detection on the rules fixture's 50 000 rows. Only results and counted work are asserted: a
// wall-clock bound fails under a loaded machine or a mutation run.
jest.mock('@kiko/transactions/merchant-name', () => {
  const actual = jest.requireActual('@kiko/transactions/merchant-name');

  return { ...actual, merchantNameOf: jest.fn(actual.merchantNameOf) };
});
jest.mock('@kiko/holdings/interest', () => {
  const actual = jest.requireActual('@kiko/holdings/interest');

  return { ...actual, daysBetween: jest.fn(actual.daysBetween) };
});

import maybe, { foldMap } from 'fnts/maybe';
import {
  at,
  chargeOf,
  holdingOf,
  bankAccountOf,
  type Currency,
} from '@kiko/test-support/recurring-ledger';
import { daysBetween } from '@kiko/holdings/interest';
import { seededRandom } from '@kiko/test-support/seeded-random';
import { merchantNameOf } from '@kiko/transactions/merchant-name';
import { buildRulesPerformanceFixture } from '@kiko/categories/category-rules/__fixtures__/rules-performance-fixture';

import { detectRecurringSeries, onePerSlotOf } from './detection';
import type { Charge, RecurringInput, RecurringLedgerRow } from './detection.types.d';

// The reads of `time` on the input rows may not pass `rows x (log2(rows) + K)`. K is the smallest
// whole number under which the first run on this fixture passed: it read `time` twice per row
// (100 000 reads), so K of -13.6 or more was needed. It is never raised. The pin sees only the
// input objects: `datedRowsOf` and the row spread in eligibility copy `time`, so every comparator
// reads a copy. What it fails on is one more pass over the input rows, past 2.61 reads per row.
// A second sort is seen by the sort-comparison pin below, and a scan that calls `daysBetween` by
// the day-gap pin; a scan over the charges that does neither is seen by no pin.
const LOGARITHM_OFFSET = -13;
// The comparator calls of every sort in one detection, over `rows x (log2(rows) + K)`, the cost of
// one sort of the ledger. The first run made 1 062 843 calls, 21.26 per row, so K needed 5.65
// or more. It is never raised, so a second sort over the charges fails it.
const SORT_COMPARISON_OFFSET = 6;
// Calls of `daysBetween` per row, the work of the fit evaluations (at most 7 calls for each pair
// of charges in a group, 5 when the nearest slot count is 0). The first run made 1 812 081
// calls, 36.24 per row. It is never raised, so a scan that compares every charge of a group
// with every other fails it.
const DAY_GAP_CALLS_PER_ROW = 37;
// Calls of `daysBetween` per charge of one dense marked key: 500 charges one a day, marked
// monthly, each scanning only the charges within a step. The first run made 54 076 calls, 108.15
// per charge, so 109 was the smallest whole number. It is never raised, so a scan of every earlier
// charge (at least 250 per charge here) fails it.
const DENSE_KEY_GAP_CALLS_PER_CHARGE = 109;
const HOLDINGS_PER_CURRENCY = { UAH: 8, USD: 4, EUR: 3, GBP: 3, BTC: 2 } as const;
const DENSE_KEY_CHARGES = 500;
const DENSE_KEY_BASE_AMOUNT = 100;
const DENSE_KEY_AMOUNT_SPREAD = 1_501;
const DENSE_KEY_SEED = 104_729;
const PLANTED_ROW_COUNT = 3;
const PLANTED_DESCRIPTION = 'Planted Gym Club';
const PLANTED_AMOUNT_MINOR_UNITS = -45_000;
const NOW = at(2026, 1, 15, 12, 0);

const { rows: fixtureRows } = buildRulesPerformanceFixture();

const holdings = Object.entries(HOLDINGS_PER_CURRENCY).flatMap(([currency, count]) =>
  Array.from({ length: count }, (_unused, index) =>
    holdingOf(`${currency}-${index}`, currency as Currency),
  ),
);

const ledgerRowsFrom = (): RecurringLedgerRow[] =>
  fixtureRows.map((row, index) => {
    const currency = row.currency as keyof typeof HOLDINGS_PER_CURRENCY;

    return chargeOf(row.id, row.time, 0, {
      holdingId: `${currency}-${index % HOLDINGS_PER_CURRENCY[currency]}`,
      description: row.description,
      source: 'manual',
      overrides: { amountMinorUnits: row.amountMinorUnits },
    });
  });

const plantMonthly = (rows: RecurringLedgerRow[]): RecurringLedgerRow[] =>
  rows.map((row, index) =>
    index < PLANTED_ROW_COUNT
      ? {
          ...row,
          holdingId: 'UAH-0',
          description: PLANTED_DESCRIPTION,
          amountMinorUnits: PLANTED_AMOUNT_MINOR_UNITS,
          time: at(2026, 1 - index, 10),
        }
      : row,
  );

const inputOf = (rows: readonly RecurringLedgerRow[]): RecurringInput => ({
  rows,
  holdings,
  accounts: [bankAccountOf('bank-account')],
});

const withCountedTimeReads = (
  rows: readonly RecurringLedgerRow[],
): { rows: RecurringLedgerRow[]; reads: () => number } => {
  let reads = 0;
  const counted = rows.map((row) => {
    const { time } = row;
    const copy = { ...row };

    Object.defineProperty(copy, 'time', {
      enumerable: true,
      get: () => {
        reads += 1;

        return time;
      },
    });

    return copy;
  });

  return { rows: counted, reads: () => reads };
};

const countedSortComparisons = (run: () => void): number => {
  const sortOfArrays = Array.prototype.sort;
  let comparisons = 0;
  const spy = jest.spyOn(Array.prototype, 'sort').mockImplementation(function (
    this: unknown[],
    compare?: (left: unknown, right: unknown) => number,
  ) {
    return sortOfArrays.call(
      this,
      foldMap(maybe(compare), (compareItems) => (left: unknown, right: unknown) => {
        comparisons += 1;

        return compareItems(left, right);
      }),
    );
  });

  try {
    run();
  } finally {
    spy.mockRestore();
  }

  return comparisons;
};

describe('detectRecurringSeries on a large ledger', () => {
  beforeEach(() => {
    jest.mocked(merchantNameOf).mockClear();
    jest.mocked(daysBetween).mockClear();
  });

  it('reads the fixture at the size the spec budgets for', () => {
    expect(fixtureRows).toHaveLength(50_000);
    expect(new Set(fixtureRows.map(({ description }) => description)).size).toBe(2_000);
  });

  it('names each distinct description at most once', () => {
    const rows = ledgerRowsFrom();

    detectRecurringSeries(inputOf(rows), NOW);

    const names = jest.mocked(merchantNameOf).mock.calls.map(([description]) => description);
    const distinctCount = new Set(rows.map(({ description }) => description)).size;

    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBeLessThanOrEqual(distinctCount);
    expect(new Set(names).size).toBe(names.length);
  });

  it('reads the time of a row within rows x (log2(rows) + K)', () => {
    const { rows, reads } = withCountedTimeReads(ledgerRowsFrom());

    detectRecurringSeries(inputOf(rows), NOW);

    const bound = rows.length * (Math.log2(rows.length) + LOGARITHM_OFFSET);

    expect(reads()).toBeGreaterThan(0);
    expect(reads()).toBeLessThanOrEqual(bound);
  });

  it('compares within rows x (log2(rows) + K) over every sort of one detection', () => {
    const rows = ledgerRowsFrom();
    const comparisons = countedSortComparisons(() => detectRecurringSeries(inputOf(rows), NOW));

    expect(comparisons).toBeGreaterThan(0);
    expect(comparisons).toBeLessThanOrEqual(
      rows.length * (Math.log2(rows.length) + SORT_COMPARISON_OFFSET),
    );
  });

  it('measures day gaps within DAY_GAP_CALLS_PER_ROW of each row', () => {
    const rows = ledgerRowsFrom();

    detectRecurringSeries(inputOf(rows), NOW);

    const calls = jest.mocked(daysBetween).mock.calls.length;

    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(rows.length * DAY_GAP_CALLS_PER_ROW);
  });

  it('measures day gaps within DENSE_KEY_GAP_CALLS_PER_CHARGE of each charge of a dense marked key', () => {
    const random = seededRandom(DENSE_KEY_SEED);
    const charges: Charge[] = Array.from({ length: DENSE_KEY_CHARGES }, (_unused, day) => ({
      id: `shop-${day}`,
      time: at(2026, 11, 3 - day),
      amount: DENSE_KEY_BASE_AMOUNT + Math.floor(random() * DENSE_KEY_AMOUNT_SPREAD),
      source: 'manual',
      holdingId: 'UAH-0',
      holdingName: 'UAH-0',
      description: 'Silpo',
    }));

    const { kept } = onePerSlotOf(charges, 'monthly', [charges[0].amount]);
    const calls = jest.mocked(daysBetween).mock.calls.length;

    expect(kept.length).toBeGreaterThan(1);
    expect(calls).toBeLessThanOrEqual(charges.length * DENSE_KEY_GAP_CALLS_PER_CHARGE);
  });

  it('finds three fixture rows planted monthly', () => {
    const found = detectRecurringSeries(inputOf(plantMonthly(ledgerRowsFrom())), NOW).filter(
      ({ merchantKey }) => merchantKey === merchantNameOf(PLANTED_DESCRIPTION).key,
    );

    expect(found.map(({ period, chargeIds }) => [period, chargeIds.length])).toEqual([
      ['monthly', PLANTED_ROW_COUNT],
    ]);
  });
});
