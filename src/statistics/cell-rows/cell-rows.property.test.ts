import { sumOf } from '@kiko/numbers';
import { calendarMonthsBetween } from '@kiko/dates';
import { sweep } from '@kiko/test-support/property-sweep';
import type { HoldingRow, TransactionRow } from '@kiko/db';
import { buildCategoryDisplayMap } from '@kiko/categories/category-display';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';
import {
  BASE_TIME,
  MINUTE,
  transactionRow,
  worldInput,
} from '@kiko/statistics/spending-ledger/__fixtures__/spending-ledger-world';

import { buildCashFlow } from '../cash-flow';
import { excludedCategoryKeysOf } from '../statistics-filter-scope';
import { buildSpendingLedger, type SpendingLedger } from '../spending-ledger';
import { buildCategoryByMonth, categorySlicesOfMonths } from '../category-by-month';

import { type CellRow, expenseRowsOf, incomeRowsOf } from '.';

/**
 * A random world, the tables built over its ledger, and the rows of every cell a user can open:
 * the base amounts of a cell's rows must add up to the cell, to the minor unit, for each account
 * filter and for a held pick of two categories.
 */

const SEED_SPREAD = 1_000_003;
const SEEDS = sweep(Array.from({ length: 30 }, (_unused, position) => 2 + position * 3));
const EDGE_CHANCE = 0.25;
const RETURNED_CHANCE = 0.5;

const DISPLAY = buildCategoryDisplayMap([
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'transport', title: 'Transport', icon: 'car' },
  { key: 'utilities', title: 'Utilities', icon: 'bolt' },
  { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
]);
const CATEGORIES = ['groceries', 'transport', 'utilities', null, 'a-deleted-category'];
const RATE_TABLE = { USDT: 40 };
const DISPLAY_INPUT = {
  categoryDisplay: DISPLAY,
  rateTable: RATE_TABLE,
  baseCurrency: 'UAH' as const,
  defaultCategoryKey: 'other',
};

// The sums never read a label.
const NO_LABEL = () => '';

const MONTHS = calendarMonthsBetween(
  new Date(2024, 0, 15).getTime(),
  new Date(2024, 4, 15).getTime(),
);
const PERIOD = { start: MONTHS[0].start, end: (MONTHS.at(-1) ?? MONTHS[0]).end };
// The ranges a cell can have: each month, then the whole period for a Total.
const RANGES = [...MONTHS, PERIOD];
const ALL_HOLDINGS = worldInput().holdings;
const holdingsOf = (...ids: string[]): HoldingRow[] =>
  ALL_HOLDINGS.filter((holding) => ids.includes(holding.id));
const ACCOUNT_FILTERS: { name: string; shown: readonly HoldingRow[] }[] = [
  { name: 'all holdings', shown: ALL_HOLDINGS },
  { name: 'the card', shown: holdingsOf('card') },
  { name: 'the card and the coin', shown: holdingsOf('card', 'coin') },
];

const pick = <Item>(random: Random, items: readonly Item[]): Item =>
  items[Math.floor(random() * items.length)] as Item;

const timeOf = (random: Random): number => {
  const month = pick(random, MONTHS);
  const draw = random();

  if (draw < EDGE_CHANCE / 2) {
    return month.start;
  }

  if (draw < EDGE_CHANCE) {
    return month.end;
  }

  return month.start + Math.floor(random() * (month.end - month.start));
};

const amountOf = (random: Random): number => 1 + Math.floor(random() * 80_000);

const KINDS = [
  'expense',
  'expense',
  'expense',
  'foreign',
  'foreignIncome',
  'income',
  'income',
  'change',
  'change',
  'edited',
  'transfer',
  'loan',
  'balanceSet',
  'cashOut',
] as const;
type Kind = (typeof KINDS)[number];

const ROWS_OF_KIND: Record<Kind, (id: string, random: Random) => TransactionRow[]> = {
  expense: (id, random) => [
    transactionRow({
      id,
      holdingId: pick(random, ['card', 'cash']),
      category: pick(random, CATEGORIES),
      amountMinorUnits: -amountOf(random),
      time: timeOf(random),
      description: `expense ${id}`,
    }),
  ],
  foreign: (id, random) => [
    transactionRow({
      id,
      holdingId: 'coin',
      category: pick(random, CATEGORIES),
      amountMinorUnits: -(1_000_000 + amountOf(random)),
      time: timeOf(random),
    }),
  ],
  foreignIncome: (id, random) => [
    transactionRow({
      id,
      holdingId: 'coin',
      amountMinorUnits: 1_000_000 + amountOf(random),
      time: timeOf(random),
    }),
  ],
  income: (id, random) => [
    transactionRow({
      id,
      holdingId: pick(random, ['card', 'cash']),
      amountMinorUnits: amountOf(random),
      time: timeOf(random),
    }),
  ],
  // A payment and its return share a time; the return is some of it, or all.
  change: (id, random) => {
    const time = timeOf(random);
    const payment = 50_000 + Math.floor(random() * 50_000);
    const returned = random() < RETURNED_CHANCE ? payment : 1 + Math.floor(random() * 5_000);

    return [
      transactionRow({
        id,
        holdingId: 'card',
        category: pick(random, CATEGORIES),
        amountMinorUnits: -payment,
        changeGroupId: `group-${id}`,
        time,
      }),
      transactionRow({
        id: `${id}-return`,
        holdingId: 'card',
        amountMinorUnits: returned,
        changeGroupId: `group-${id}`,
        time,
      }),
    ];
  },
  // A date edit moves one row of a group, so the group can fall in two months.
  edited: (id, random) => [
    transactionRow({
      id,
      holdingId: 'card',
      category: 'groceries',
      amountMinorUnits: -30_000,
      changeGroupId: `group-${id}`,
      time: timeOf(random),
    }),
    transactionRow({
      id: `${id}-return`,
      holdingId: 'card',
      amountMinorUnits: 30_000,
      changeGroupId: `group-${id}`,
      time: timeOf(random),
    }),
  ],
  // The debit sits within a second of a month's end, so its credit lands in the next month.
  transfer: (id, random) => {
    const amount = 1_000_000 + Math.floor(random() * 900_000) * 2 + 1;
    const debitTime = pick(random, MONTHS).end - Math.floor(random() * 500);

    return [
      transactionRow({ id, holdingId: 'card', amountMinorUnits: -amount, time: debitTime }),
      transactionRow({
        id: `${id}-credit`,
        holdingId: 'cash',
        amountMinorUnits: amount,
        time: debitTime + 1_000,
      }),
    ];
  },
  loan: (id, random) => [
    transactionRow({
      id,
      holdingId: 'card',
      category: 'utilities',
      amountMinorUnits: -12_000,
      loanHoldingId: 'loan',
      time: BASE_TIME + Math.floor(random() * 2_000) * MINUTE,
    }),
  ],
  balanceSet: (id, random) => [
    transactionRow({
      id,
      holdingId: 'card',
      amountMinorUnits: pick(random, [-1, 1]) * amountOf(random),
      setsBalance: true,
      time: timeOf(random),
    }),
  ],
  cashOut: (id, random) => [
    transactionRow({
      id,
      holdingId: 'card',
      amountMinorUnits: -amountOf(random),
      mcc: 6011,
      time: timeOf(random),
    }),
  ],
};

const worldOf = (seed: number): TransactionRow[] => {
  const random = seededRandom(seed * SEED_SPREAD);
  const count = 12 + Math.floor(random() * 30);
  // Every kind appears at least once, so a small world still reaches each rule.
  const kinds = [...KINDS, ...Array.from({ length: count }, () => pick(random, KINDS))];

  return kinds.flatMap((kind, index) => ROWS_OF_KIND[kind](`row-${index}`, random));
};

const baseSumOf = (rows: readonly CellRow[]): number =>
  sumOf(rows.map((row) => row.base.minorUnits));

const rowsIn = (
  ledger: SpendingLedger,
  range: { start: number; end: number },
  held: Parameters<typeof expenseRowsOf>[2] = {},
) => expenseRowsOf(ledger, range, held, { ...DISPLAY_INPUT, describe: NO_LABEL });

const incomeIn = (ledger: SpendingLedger, range: { start: number; end: number }) =>
  incomeRowsOf(ledger, range, RATE_TABLE, 'UAH', NO_LABEL);

const tableInput = (ledger: SpendingLedger) => ({
  ledger,
  months: MONTHS,
  ...DISPLAY_INPUT,
  scheme: 'dark' as const,
});

const flowOf = (ledger: SpendingLedger) =>
  buildCashFlow({
    ledger,
    months: MONTHS,
    ...DISPLAY_INPUT,
    firstCompleteIndex: null,
    currentIsPartial: false,
  });

/** A month's cell by the range's place, and the Total for the whole period at the end. */
const cellAt = (cells: readonly number[], total: number, rangeIndex: number): number =>
  rangeIndex < MONTHS.length ? cells[rangeIndex] : total;

const ledgerOf = (transactions: TransactionRow[], shown: readonly HoldingRow[]) =>
  buildSpendingLedger(worldInput({ transactions, shownHoldings: shown }));

describe('the rows of a cell add up to the cell', () => {
  describe.each(ACCOUNT_FILTERS)('with the account filter on $name', ({ shown }) => {
    it.each(SEEDS)('for every C1 category cell, month and Total, seed %i', (seed) => {
      const ledger = ledgerOf(worldOf(seed), shown);
      const table = buildCategoryByMonth(tableInput(ledger));

      for (const row of table.rows) {
        RANGES.forEach((range, rangeIndex) => {
          expect(baseSumOf(rowsIn(ledger, range, { categoryKey: row.key }))).toBe(
            cellAt(row.cells, row.total, rangeIndex),
          );
        });
      }
    });

    it.each(SEEDS)('for every C1 All cell with no pick, seed %i', (seed) => {
      const ledger = ledgerOf(worldOf(seed), shown);
      const table = buildCategoryByMonth(tableInput(ledger));

      RANGES.forEach((range, rangeIndex) => {
        expect(baseSumOf(rowsIn(ledger, range))).toBe(
          cellAt(table.allCells, table.allTotal, rangeIndex),
        );
      });
    });

    it.each(SEEDS)('for every C1 All cell under a held pick of two categories, seed %i', (seed) => {
      const ledger = ledgerOf(worldOf(seed), shown);
      const random = seededRandom(seed * SEED_SPREAD + 5);
      const slices = categorySlicesOfMonths(tableInput(ledger));
      const keys = [...new Set(slices.map((slice) => slice.key))];
      const kept = new Set([pick(random, keys), pick(random, keys)]);
      const excludedCategories = excludedCategoryKeysOf(slices, kept);
      const table = buildCategoryByMonth({ ...tableInput(ledger), excludedCategories });

      RANGES.forEach((range, rangeIndex) => {
        const rows = rowsIn(ledger, range, { excludedCategories });
        const keptIds = [...kept].flatMap((categoryKey) =>
          rowsIn(ledger, range, { categoryKey }).map((row) => row.id),
        );

        expect(baseSumOf(rows)).toBe(cellAt(table.allCells, table.allTotal, rangeIndex));
        expect(rows.map((row) => row.id).sort()).toEqual(keptIds.sort());
      });
    });

    it.each(SEEDS)('for every C2 expense cell, which no pick changes, seed %i', (seed) => {
      const ledger = ledgerOf(worldOf(seed), shown);
      const { expenses } = flowOf(ledger);

      RANGES.forEach((range, rangeIndex) => {
        expect(baseSumOf(rowsIn(ledger, range))).toBe(
          cellAt(expenses.cells, expenses.total, rangeIndex),
        );
      });
    });

    it.each(SEEDS)('for every C2 income cell, month and Total, seed %i', (seed) => {
      const ledger = ledgerOf(worldOf(seed), shown);
      const { income } = flowOf(ledger);

      RANGES.forEach((range, rangeIndex) => {
        expect(baseSumOf(incomeIn(ledger, range))).toBe(
          cellAt(income.cells, income.total, rangeIndex),
        );
      });
    });
  });

  describe('the worlds', () => {
    const ledgers = SEEDS.map((seed) => ledgerOf(worldOf(seed), ALL_HOLDINGS));

    it('differ from one seed to the next', () => {
      const totals = SEEDS.map((seed) => sumOf(worldOf(seed).map((row) => row.amountMinorUnits)));

      expect(new Set(totals).size).toBe(SEEDS.length);
    });

    it('reach spending, income, a derived loan row and the exclusion rules', () => {
      for (const ledger of ledgers) {
        expect(rowsIn(ledger, PERIOD).length).toBeGreaterThan(0);
        expect(incomeIn(ledger, PERIOD).length).toBeGreaterThan(0);
        expect(rowsIn(ledger, PERIOD).some((row) => row.paymentId !== undefined)).toBe(true);
        expect(ledger.excludedTransactionIds.size).toBeGreaterThan(0);
      }
    });

    it('draw a payment that its returns net below its own amount', () => {
      const netted = ledgers.some((ledger) =>
        rowsIn(ledger, PERIOD).some((cellRow) =>
          ledger.shownRows.some(
            (row) => row.id === cellRow.id && cellRow.native.minorUnits < -row.amountMinorUnits,
          ),
        ),
      );

      expect(netted).toBe(true);
    });

    it('draw a held pick that removes rows from the All cell', () => {
      const removed = ledgers.some((ledger) => {
        const slices = categorySlicesOfMonths(tableInput(ledger));
        const excludedCategories = excludedCategoryKeysOf(slices, new Set(['groceries']));

        return (
          rowsIn(ledger, PERIOD, { excludedCategories }).length < rowsIn(ledger, PERIOD).length
        );
      });

      expect(removed).toBe(true);
    });
  });
});
