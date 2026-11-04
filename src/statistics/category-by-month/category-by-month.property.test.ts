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

import { buildCategoryBreakdown } from '../category-breakdown';
import { buildSpendingLedger, spendingRowsIn, type SpendingLedger } from '../spending-ledger';

import { buildCategoryByMonth } from '.';

/**
 * Each row of a random world is made from a kind (a plain expense, income, a payment with its
 * change returns, a transfer between two own holdings whose legs may fall either side of a month
 * edge, an exchange leg, a loan payment), and the table is compared with the donut the screen
 * draws: `spendingRowsIn` over the month's range, then `buildCategoryBreakdown`, over the same
 * ledger. The ledger is built by `buildSpendingLedger` for every account filter.
 */

const SEED_SPREAD = 1_000_003;
const SEEDS = sweep(Array.from({ length: 30 }, (_unused, position) => 1 + position * 3));
const EDGE_CHANCE = 0.25;
const REACHED_CHANCE = 0.8;

const DISPLAY = buildCategoryDisplayMap([
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'transport', title: 'Transport', icon: 'car' },
  { key: 'utilities', title: 'Utilities', icon: 'bolt' },
  { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
  { key: 'refunded', title: 'Refunded', icon: 'arrow.uturn.left' },
]);
// The edited payments' own category, so that a world whose edited payments are all netted out by
// their returns leaves a category the period nets to nothing.
const REFUNDED = 'refunded';
const CATEGORIES = ['groceries', 'transport', 'utilities', null, 'a-deleted-category'];

const MONTHS = calendarMonthsBetween(
  new Date(2024, 0, 15).getTime(),
  new Date(2024, 5, 15).getTime(),
);
const PERIOD = { from: MONTHS[0].start, to: (MONTHS.at(-1) ?? MONTHS[0]).end };
const ALL_HOLDINGS = worldInput().holdings;
const holdingsOf = (...ids: string[]): HoldingRow[] =>
  ALL_HOLDINGS.filter((holding) => ids.includes(holding.id));
const ACCOUNT_FILTERS: { name: string; shown: readonly HoldingRow[] }[] = [
  { name: 'all holdings', shown: ALL_HOLDINGS },
  { name: 'the card', shown: holdingsOf('card') },
  { name: 'the cash', shown: holdingsOf('cash') },
  { name: 'the card and the cash', shown: holdingsOf('card', 'cash') },
];

const pick = <Item>(random: Random, items: readonly Item[]): Item =>
  items[Math.floor(random() * items.length)] as Item;

/** A time in a random month, the first or the last millisecond of it with a fixed chance. */
const timeInRandomMonth = (random: Random): number => {
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

type RowKind = 'expense' | 'income' | 'change' | 'edited' | 'transfer' | 'exchange' | 'loan';

const KINDS: RowKind[] = [
  'expense',
  'expense',
  'expense',
  'expense',
  'income',
  'change',
  'change',
  'edited',
  'edited',
  'transfer',
  'transfer',
  'exchange',
  'loan',
];

type RowMaker = (id: string, random: Random) => TransactionRow[];

const ROWS_OF_KIND: Record<RowKind, RowMaker> = {
  expense: (id, random) => [
    transactionRow({
      id,
      holdingId: pick(random, ['card', 'cash']),
      category: pick(random, CATEGORIES),
      amountMinorUnits: -amountOf(random),
      time: timeInRandomMonth(random),
    }),
  ],
  income: (id, random) => [
    transactionRow({
      id,
      holdingId: pick(random, ['card', 'cash']),
      category: pick(random, CATEGORIES),
      amountMinorUnits: amountOf(random),
      time: timeInRandomMonth(random),
    }),
  ],
  change: (id, random) => {
    const time = timeInRandomMonth(random);
    const holdingId = pick(random, ['card', 'cash']);
    const returns = 1 + Math.floor(random() * 2);

    return [
      transactionRow({
        id,
        holdingId,
        category: pick(random, CATEGORIES),
        amountMinorUnits: -(50_000 + Math.floor(random() * 50_000)),
        changeGroupId: `group-${id}`,
        time,
      }),
      ...Array.from({ length: returns }, (_unused, returnIndex) =>
        transactionRow({
          id: `${id}-return-${returnIndex}`,
          holdingId,
          category: null,
          amountMinorUnits: 1 + Math.floor(random() * 5_000),
          changeGroupId: `group-${id}`,
          time,
        }),
      ),
    ];
  },
  // A payment whose date was edited apart from its group: the repo moves one row's `time` only,
  // so the returns keep the group's time. Most returns reach the payment, which nets it out of the
  // period and not out of a month the returns are not in.
  edited: (id, random) => {
    const holdingId = pick(random, ['card', 'cash']);
    const payment = 20_000 + Math.floor(random() * 50_000);
    const returned =
      random() < REACHED_CHANCE
        ? payment + Math.floor(random() * 5_000)
        : 1 + Math.floor(random() * 10_000);

    return [
      transactionRow({
        id,
        holdingId,
        category: REFUNDED,
        amountMinorUnits: -payment,
        changeGroupId: `group-${id}`,
        time: timeInRandomMonth(random),
      }),
      transactionRow({
        id: `${id}-return`,
        holdingId,
        category: null,
        amountMinorUnits: returned,
        changeGroupId: `group-${id}`,
        time: timeInRandomMonth(random),
      }),
    ];
  },
  // A large odd amount, so a pair seldom matches another pair's legs. The debit sits within a
  // second of a month's end half the time, so its credit lands in the next month.
  transfer: (id, random) => {
    const amount = 1_000_000 + Math.floor(random() * 900_000) * 2 + 1;
    const month = pick(random, MONTHS);
    const debitTime = random() < 0.5 ? month.end - Math.floor(random() * 500) : month.start + 5_000;

    return [
      transactionRow({
        id,
        holdingId: 'card',
        category: pick(random, CATEGORIES),
        amountMinorUnits: -amount,
        time: debitTime,
      }),
      transactionRow({
        id: `${id}-credit`,
        holdingId: 'cash',
        category: null,
        amountMinorUnits: amount,
        time: debitTime + 1_000,
      }),
    ];
  },
  exchange: (id, random) => [
    transactionRow({
      id,
      holdingId: 'card',
      category: pick(random, CATEGORIES),
      amountMinorUnits: -amountOf(random),
      exchangeCounterpartHoldingId: 'coin',
      time: timeInRandomMonth(random),
    }),
  ],
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
};

type World = { transactions: TransactionRow[]; kinds: RowKind[] };

const worldOf = (seed: number): World => {
  const random = seededRandom(seed * SEED_SPREAD);
  const rowCount = 14 + Math.floor(random() * 30);
  // Every kind appears at least once, so a world of a few rows still tests each rule.
  const kinds = [...KINDS, ...Array.from({ length: rowCount }, () => pick(random, KINDS))];

  return {
    kinds,
    transactions: kinds.flatMap((kind, index) => ROWS_OF_KIND[kind](`row-${index}`, random)),
  };
};

const crossesMonthEdge = (world: World): boolean =>
  world.transactions.some((transaction) => {
    const credit = world.transactions.find((entry) => entry.id === `${transaction.id}-credit`);

    return (
      credit !== undefined &&
      new Date(credit.time).getMonth() !== new Date(transaction.time).getMonth()
    );
  });

const donutOf = (
  ledger: SpendingLedger,
  range: { from: number; to: number },
  excludedCategories?: ReadonlySet<string>,
) =>
  buildCategoryBreakdown({
    transactions: spendingRowsIn(ledger, range.from, range.to),
    categoryDisplay: DISPLAY,
    rateTable: {},
    baseCurrency: 'UAH',
    defaultCategoryKey: 'other',
    excludedCategories,
    excludedTransactionIds: ledger.excludedTransactionIds,
  });

const sumOf = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0);

const tableOf = (ledger: SpendingLedger, excludedCategories?: ReadonlySet<string>) =>
  buildCategoryByMonth({
    ledger,
    months: MONTHS,
    categoryDisplay: DISPLAY,
    rateTable: {},
    baseCurrency: 'UAH',
    defaultCategoryKey: 'other',
    excludedCategories,
  });

const expectMonthsToEqualDonuts = (
  table: ReturnType<typeof tableOf>,
  monthDonuts: ReturnType<typeof donutOf>[],
) => {
  MONTHS.forEach((_month, monthIndex) => {
    for (const row of table.rows) {
      const slice = monthDonuts[monthIndex].find((entry) => entry.key === row.key);

      expect(row.cells[monthIndex]).toBe(slice?.amount ?? 0);
    }

    for (const slice of monthDonuts[monthIndex]) {
      expect(table.rows.find((row) => row.key === slice.key)?.cells[monthIndex]).toBe(slice.amount);
    }

    expect(table.allCells[monthIndex]).toBe(
      sumOf(monthDonuts[monthIndex].map((slice) => slice.amount)),
    );
  });
};

const checkAgainstDonut = (ledger: SpendingLedger, excludedCategories?: ReadonlySet<string>) => {
  const table = tableOf(ledger, excludedCategories);
  const monthDonuts = MONTHS.map((month) =>
    donutOf(ledger, { from: month.start, to: month.end }, excludedCategories),
  );
  const periodDonut = donutOf(ledger, PERIOD, excludedCategories);

  expectMonthsToEqualDonuts(table, monthDonuts);
  // A row that a month spends on and the whole period nets out has no slice, and a total of zero.
  expect(table.rows.map((row) => row.key)).toEqual(
    expect.arrayContaining(periodDonut.map((slice) => slice.key)),
  );

  for (const row of table.rows) {
    expect(row.total).toBe(periodDonut.find((slice) => slice.key === row.key)?.amount ?? 0);
  }

  expect(table.allTotal).toBe(sumOf(periodDonut.map((slice) => slice.amount)));
  expect(sumOf(table.rows.map((row) => row.total))).toBe(table.allTotal);
};

describe('buildCategoryByMonth against the donut', () => {
  describe.each(ACCOUNT_FILTERS)('with the account filter on $name', ({ shown }) => {
    it.each(SEEDS)('equals the donut of every month and of the period, seed %i', (seed) => {
      const { transactions } = worldOf(seed);

      checkAgainstDonut(buildSpendingLedger(worldInput({ transactions, shownHoldings: shown })));
    });

    it.each(SEEDS)('equals the donut with a held category pick, seed %i', (seed) => {
      const { transactions } = worldOf(seed);
      const ledger = buildSpendingLedger(worldInput({ transactions, shownHoldings: shown }));
      const random = seededRandom(seed * SEED_SPREAD + 7);
      const excluded = new Set(
        donutOf(ledger, PERIOD)
          .map((slice) => slice.key)
          .filter(() => random() < 0.5),
      );

      checkAgainstDonut(ledger, excluded);
    });
  });

  describe('the worlds', () => {
    const worlds = SEEDS.map((seed) => worldOf(seed));

    it('differ from one seed to the next', () => {
      const totals = worlds.map((world) =>
        sumOf(world.transactions.map((transaction) => transaction.amountMinorUnits)),
      );

      expect(new Set(totals).size).toBe(worlds.length);
    });

    it('draw every kind the rules are about, with transfers whose legs cross a month edge', () => {
      for (const world of worlds) {
        expect(new Set(world.kinds)).toEqual(new Set(KINDS));
      }

      expect(worlds.some(crossesMonthEdge)).toBe(true);
    });

    it('edit a payment apart from its group, so that a Total is not the sum of its cells', () => {
      const ledgers = worlds.map((world) =>
        buildSpendingLedger(worldInput({ transactions: world.transactions })),
      );
      const rowsOf = ledgers.flatMap((ledger) => tableOf(ledger).rows);

      expect(rowsOf.some((row) => row.total !== sumOf(row.cells))).toBe(true);
    });

    it('draw a month of spending that its whole period nets out, a row with a total of zero', () => {
      const rowsOf = worlds.flatMap(
        (world) =>
          tableOf(buildSpendingLedger(worldInput({ transactions: world.transactions }))).rows,
      );

      expect(rowsOf.some((row) => row.total === 0 && sumOf(row.cells) > 0)).toBe(true);
    });

    it('reach the exclusion rules and the loan entries, so the equality is not between empty sets', () => {
      for (const world of worlds) {
        const ledger = buildSpendingLedger(worldInput({ transactions: world.transactions }));

        expect(ledger.excludedTransactionIds.size).toBeGreaterThan(0);
        expect(ledger.trendTransactions.some((row) => row.id.startsWith('loan-interest:'))).toBe(
          true,
        );
        expect(tableOf(ledger).rows.length).toBeGreaterThan(0);
      }
    });
  });
});
