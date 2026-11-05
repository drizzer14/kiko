// Detection on the rules fixture's 50 000 rows. Only results and counted work are asserted: a
// wall-clock bound fails under a loaded machine or a mutation run.
jest.mock('@kiko/transactions/merchant-name', () => {
  const actual = jest.requireActual('@kiko/transactions/merchant-name');

  return { ...actual, merchantNameOf: jest.fn(actual.merchantNameOf) };
});

import { merchantNameOf } from '@kiko/transactions/merchant-name';
import { buildRulesPerformanceFixture } from '@kiko/categories/category-rules/__fixtures__/rules-performance-fixture';

import { detectRecurringSeries } from './detection';
import type { RecurringInput, RecurringLedgerRow } from './detection.d';
import { at, chargeOf, holdingOf, bankAccountOf, type Currency } from './detection-test-helper';

// The reads of `time` may not pass `rows x (log2(rows) + K)`, the cost of sorting by time. K is
// the smallest whole number under which the first run on this fixture passed: it read `time` twice
// per row (100 000 reads), so rows x (log2(rows) + K) needed K of -13.6 or more. It is never
// raised, so a pass over the rows that grows past two reads of each fails.
const LOGARITHM_OFFSET = -13;
const HOLDINGS_PER_CURRENCY = { UAH: 8, USD: 4, EUR: 3, GBP: 3, BTC: 2 } as const;
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

describe('detectRecurringSeries on a large ledger', () => {
  beforeEach(() => {
    jest.mocked(merchantNameOf).mockClear();
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

  it('finds three fixture rows planted monthly', () => {
    const found = detectRecurringSeries(inputOf(plantMonthly(ledgerRowsFrom())), NOW).filter(
      ({ merchantKey }) => merchantKey === merchantNameOf(PLANTED_DESCRIPTION).key,
    );

    expect(found.map(({ period, chargeIds }) => [period, chargeIds.length])).toEqual([
      ['monthly', PLANTED_ROW_COUNT],
    ]);
  });
});
