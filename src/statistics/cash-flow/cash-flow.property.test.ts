import { calendarMonthsBetween } from '@kiko/dates';
import { sweep } from '@kiko/test-support/property-sweep';
import type { HoldingRow, TransactionRow } from '@kiko/db';
import { buildCategoryDisplayMap } from '@kiko/categories/category-display';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';
import {
  BASE_TIME,
  transactionRow,
  worldInput,
} from '@kiko/statistics/spending-ledger/__fixtures__/spending-ledger-world';

import { buildCategoryBreakdown } from '../category-breakdown';
import { buildSpendingLedger, spendingRowsIn, type SpendingLedger } from '../spending-ledger';

import { buildCashFlow } from '.';

/**
 * Each row of a random world is made from a kind. A kind either counts as income (a plain credit,
 * a foreign credit) or is none of it, and the cash flow is compared with an oracle that knows the
 * kind: income is exactly the credits of the two income kinds under a shown holding, and
 * expenses are the donut of each month. The income amounts sit in a band that no debit of the
 * world uses, so no matcher can pair an income row with a debit by chance.
 */

const SEED_SPREAD = 1_000_003;
const SEEDS = sweep(Array.from({ length: 30 }, (_unused, position) => 2 + position * 3));
const EDGE_CHANCE = 0.25;

const DISPLAY = buildCategoryDisplayMap([
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
]);
const CATEGORIES = ['groceries', null, 'a-deleted-category'];
const RATE_TABLE = { USDT: 40 };

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
  { name: 'the cash and the coin', shown: holdingsOf('cash', 'coin') },
];

const pick = <Item>(random: Random, items: readonly Item[]): Item =>
  items[Math.floor(random() * items.length)] as Item;

/** Half the draws land on the first or the last millisecond of a month. */
const timeInRandomMonth = (random: Random): number => {
  const month = pick(random, MONTHS);

  return random() < EDGE_CHANCE
    ? pick(random, [month.start, month.end])
    : month.start + Math.floor(random() * (month.end - month.start));
};

// Odd and above every debit of the world below, so no income row has a same-amount partner.
const INCOME_FLOOR = 200_001;
const incomeAmountOf = (random: Random): number => INCOME_FLOOR + 2 * Math.floor(random() * 80_000);
const expenseAmountOf = (random: Random): number => 2 + 2 * Math.floor(random() * 40_000);

type RowKind =
  | 'salary'
  | 'foreignIncome'
  | 'expense'
  | 'change'
  | 'transfer'
  | 'exchangeCredit'
  | 'balanceSet'
  | 'loanCredit'
  | 'depositCredit'
  | 'cashOutCredit';

const KINDS: RowKind[] = [
  'salary',
  'salary',
  'foreignIncome',
  'expense',
  'expense',
  'change',
  'transfer',
  'transfer',
  'exchangeCredit',
  'balanceSet',
  'loanCredit',
  'depositCredit',
  'cashOutCredit',
];
const INCOME_KINDS = new Set<RowKind>(['salary', 'foreignIncome']);

type RowMaker = (id: string, random: Random) => TransactionRow[];

const creditRow = (id: string, random: Random, overrides: Partial<TransactionRow>) =>
  transactionRow({
    id,
    holdingId: pick(random, ['card', 'cash']),
    amountMinorUnits: incomeAmountOf(random),
    time: timeInRandomMonth(random),
    ...overrides,
  });

const ROWS_OF_KIND: Record<RowKind, RowMaker> = {
  salary: (id, random) => [creditRow(id, random, {})],
  foreignIncome: (id, random) => [creditRow(id, random, { holdingId: 'coin' })],
  expense: (id, random) => [
    transactionRow({
      id,
      holdingId: pick(random, ['card', 'cash']),
      category: pick(random, CATEGORIES),
      amountMinorUnits: -expenseAmountOf(random),
      time: timeInRandomMonth(random),
    }),
  ],
  change: (id, random) => {
    const time = timeInRandomMonth(random);
    const holdingId = pick(random, ['card', 'cash']);

    return [
      transactionRow({
        id,
        holdingId,
        category: pick(random, CATEGORIES),
        amountMinorUnits: -(50_000 + 2 * Math.floor(random() * 20_000)),
        changeGroupId: `group-${id}`,
        time,
      }),
      creditRow(`${id}-return`, random, {
        holdingId,
        amountMinorUnits: 1 + Math.floor(random() * 5_000),
        changeGroupId: `group-${id}`,
        time,
      }),
    ];
  },
  // The debit sits within a second of a month's end half the time, so its credit lands in the
  // next month: a pair must stay out of income whichever month holds each leg.
  transfer: (id, random) => {
    const amount = 1_000_001 + 2 * Math.floor(random() * 900_000);
    const month = pick(random, MONTHS);
    const debitTime = random() < 0.5 ? month.end - Math.floor(random() * 500) : month.start + 5_000;

    return [
      transactionRow({ id, holdingId: 'card', amountMinorUnits: -amount, time: debitTime }),
      creditRow(`${id}-credit`, random, {
        holdingId: 'cash',
        amountMinorUnits: amount,
        time: debitTime + 1_000,
      }),
    ];
  },
  exchangeCredit: (id, random) => [creditRow(id, random, { exchangeCounterpartHoldingId: 'coin' })],
  balanceSet: (id, random) => [
    creditRow(id, random, { setsBalance: true }),
    transactionRow({
      id: `${id}-negative`,
      holdingId: pick(random, ['card', 'cash']),
      amountMinorUnits: -expenseAmountOf(random),
      setsBalance: true,
      time: timeInRandomMonth(random),
    }),
  ],
  loanCredit: (id, random) => [
    creditRow(id, random, { loanHoldingId: 'loan', time: BASE_TIME + 1_000 }),
  ],
  depositCredit: (id, random) => [creditRow(id, random, { description: 'Повернення депозиту' })],
  cashOutCredit: (id, random) => [creditRow(id, random, { mcc: 6011 })],
};

type World = { transactions: TransactionRow[]; kinds: RowKind[] };

const worldOf = (seed: number): World => {
  const random = seededRandom(seed * SEED_SPREAD);
  const rowCount = 12 + Math.floor(random() * 30);
  // Every kind appears at least once, so a world of a few rows still tests each rule.
  const kinds = [...KINDS, ...Array.from({ length: rowCount }, () => pick(random, KINDS))];
  const transactions = kinds.flatMap((kind, index) =>
    ROWS_OF_KIND[kind](`${kind}-${index}`, random),
  );

  return { kinds, transactions };
};

const sumOf = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0);

const inputOf = (ledger: SpendingLedger) => ({
  ledger,
  months: MONTHS,
  categoryDisplay: DISPLAY,
  rateTable: RATE_TABLE,
  baseCurrency: 'UAH' as const,
  defaultCategoryKey: 'other',
});

const donutOf = (ledger: SpendingLedger, range: { from: number; to: number }) =>
  buildCategoryBreakdown({
    transactions: spendingRowsIn(ledger, range.from, range.to),
    categoryDisplay: DISPLAY,
    rateTable: RATE_TABLE,
    baseCurrency: 'UAH',
    defaultCategoryKey: 'other',
    excludedTransactionIds: ledger.excludedTransactionIds,
  });

// USDT is 8 decimals and its rate is UAH 40; UAH has 2.
const UAH_MINOR_PER_USDT_MINOR = (40 * 100) / 10 ** 8;
const baseAmountOf = (row: TransactionRow): number =>
  row.holdingId === 'coin'
    ? Math.round(row.amountMinorUnits * UAH_MINOR_PER_USDT_MINOR)
    : row.amountMinorUnits;

/** What the world's own income rows add to a month, under the shown holdings. */
const incomeOracleOf = (
  world: World,
  shown: readonly HoldingRow[],
  month: { start: number; end: number },
): number =>
  sumOf(
    world.transactions
      .filter((row) => {
        const kind = world.kinds[Number(row.id.split('-').at(-1))];

        return (
          INCOME_KINDS.has(kind) &&
          shown.some((holding) => holding.id === row.holdingId) &&
          row.time >= month.start &&
          row.time <= month.end
        );
      })
      .map(baseAmountOf),
  );

describe('buildCashFlow against the donut and the kinds of row', () => {
  describe.each(ACCOUNT_FILTERS)('with the account filter on $name', ({ shown }) => {
    it.each(SEEDS)('has the expenses of every month equal to its donut, seed %i', (seed) => {
      const world = worldOf(seed);
      const ledger = buildSpendingLedger(
        worldInput({ transactions: world.transactions, shownHoldings: shown }),
      );
      const { expenses } = buildCashFlow({
        ...inputOf(ledger),
        firstCompleteIndex: null,
        currentIsPartial: false,
      });

      MONTHS.forEach((month, index) => {
        const slices = donutOf(ledger, { from: month.start, to: month.end });

        expect(expenses.cells[index]).toBe(sumOf(slices.map((slice) => slice.amount)));
      });
      expect(expenses.total).toBe(sumOf(donutOf(ledger, PERIOD).map((slice) => slice.amount)));
    });

    it.each(SEEDS)('counts as income the credits of the income kinds only, seed %i', (seed) => {
      const world = worldOf(seed);
      const ledger = buildSpendingLedger(
        worldInput({ transactions: world.transactions, shownHoldings: shown }),
      );
      const { income, expenses, net, savingsRate } = buildCashFlow({
        ...inputOf(ledger),
        firstCompleteIndex: 0,
        currentIsPartial: false,
      });

      MONTHS.forEach((month, index) => {
        const oracle = incomeOracleOf(world, shown, month);

        expect(income.cells[index]).toBe(oracle);
        expect(net.cells[index]).toBe(oracle - expenses.cells[index]);
        expect(savingsRate.cells[index]).toBe(
          oracle === 0 ? null : (oracle - expenses.cells[index]) / oracle,
        );
      });
      expect(income.total).toBe(sumOf(income.cells));
      expect(net.total).toBe(income.total - expenses.total);
    });
  });

  describe('the worlds', () => {
    const worlds = SEEDS.map((seed) => worldOf(seed));

    it('draw every kind the income rule is about', () => {
      for (const world of worlds) {
        expect(new Set(world.kinds)).toEqual(new Set(KINDS));
      }
    });

    it('differ from one seed to the next', () => {
      const totals = worlds.map((world) =>
        sumOf(world.transactions.map((transaction) => transaction.amountMinorUnits)),
      );

      expect(new Set(totals).size).toBe(worlds.length);
    });
  });
});
