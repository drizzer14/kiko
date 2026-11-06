import { calendarMonthsBetween } from '@kiko/dates';
import type { HoldingRow, TransactionRow } from '@kiko/db';
import { buildCategoryDisplayMap } from '@kiko/categories/category-display';
import {
  BASE_TIME,
  CARD,
  CRYPTO,
  MINUTE,
  transactionRow,
  worldInput,
} from '@kiko/statistics/spending-ledger/__fixtures__/spending-ledger-world';

import { buildSpendingLedger } from '../spending-ledger';

import { buildCashFlow, isIncomeRow } from '.';

const DISPLAY = buildCategoryDisplayMap([
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
]);
const OWN_IBAN = 'UA213223130000026007233566001';
// A second own card, so that a transfer to its IBAN is an own transfer.
const OTHER_CARD: HoldingRow = { ...CARD, id: 'card-b', metadata: { iban: OWN_IBAN } };
// The fiat balance of the Binance account, where a withdrawal to the bank is debited.
const FIAT: HoldingRow = { ...CARD, id: 'fiat', accountId: CRYPTO.id };
const HOLDINGS = [...worldInput().holdings, OTHER_CARD, FIAT];
// 2.5 USDT, which is UAH 100 at the rate below.
const TWO_AND_A_HALF_USDT = 250_000_000;
const UAH_100 = 10_000;
const RATE_TABLE = { USDT: 40 };

// January 2024, which holds BASE_TIME.
const JANUARY_ONLY = calendarMonthsBetween(BASE_TIME, BASE_TIME);

const ledgerOf = (transactions: TransactionRow[], shownHoldings: HoldingRow[] = HOLDINGS) =>
  buildSpendingLedger(worldInput({ transactions, holdings: HOLDINGS, shownHoldings }));

type FlowInput = Parameters<typeof buildCashFlow>[0];

const flowOf = (transactions: TransactionRow[], overrides: Partial<FlowInput> = {}) =>
  buildCashFlow({
    ledger: ledgerOf(transactions),
    months: JANUARY_ONLY,
    rateTable: RATE_TABLE,
    baseCurrency: 'UAH',
    categoryDisplay: DISPLAY,
    defaultCategoryKey: 'other',
    firstCompleteIndex: null,
    currentIsPartial: false,
    ...overrides,
  });

const rowOf = (id: string, amountMinorUnits: number, overrides: Partial<TransactionRow> = {}) =>
  transactionRow({ id, holdingId: 'card', amountMinorUnits, time: BASE_TIME, ...overrides });

const incomeOf = (transactions: TransactionRow[]): number => flowOf(transactions).income.total;

describe('isIncomeRow', () => {
  const ledger = ledgerOf([rowOf('salary', 50_000), rowOf('debit', -50_000)]);
  const [salary, debit] = ledger.shownRows;

  it('takes a credit that no rule excluded', () => {
    expect(isIncomeRow(salary, new Set())).toBe(true);
  });

  it('leaves a credit out when its id is excluded', () => {
    expect(isIncomeRow(salary, new Set(['salary']))).toBe(false);
  });

  it('leaves a debit out', () => {
    expect(isIncomeRow(debit, new Set())).toBe(false);
  });

  it('leaves out a row that sets a balance, on the mark itself and not only by the id set', () => {
    expect(isIncomeRow({ ...salary, setsBalance: true }, new Set())).toBe(false);
  });

  it('leaves out a change return, which is netted from the expenses', () => {
    expect(isIncomeRow({ ...salary, changeGroupId: 'group' }, new Set())).toBe(false);
  });
});

describe('the income matrix', () => {
  it('counts a salary, a plain credit', () => {
    expect(incomeOf([rowOf('salary', 50_000, { description: 'Salary' })])).toBe(50_000);
  });

  it('counts a Binance Earn reward, which carries no marker, at today rate', () => {
    const reward = rowOf('reward', TWO_AND_A_HALF_USDT, {
      holdingId: 'coin',
      description: 'Simple Earn Flexible',
    });

    expect(incomeOf([reward])).toBe(UAH_100);
  });

  it('leaves out a change return, and nets it from the expenses', () => {
    const flow = flowOf([
      rowOf('payment', -80_00, { changeGroupId: 'group', category: 'groceries' }),
      rowOf('change', 20_00, { changeGroupId: 'group' }),
    ]);

    expect(flow.income.total).toBe(0);
    expect(flow.expenses.total).toBe(60_00);
  });

  it('leaves out a row that sets a balance', () => {
    expect(incomeOf([rowOf('opening', 100_000, { setsBalance: true })])).toBe(0);
  });

  it('counts a real credit whose only same-amount partner is a balance-set debit', () => {
    const flow = flowOf([
      rowOf('balance-debit', -75_000, { setsBalance: true }),
      rowOf('real-credit', 75_000, { holdingId: 'cash', time: BASE_TIME + MINUTE }),
    ]);

    expect(flow.income.total).toBe(75_000);
    expect(flow.expenses.total).toBe(0);
  });

  it('leaves out the credit leg of a matched own transfer', () => {
    const flow = flowOf([
      rowOf('out', -50_000),
      rowOf('in', 50_000, { holdingId: 'cash', time: BASE_TIME + MINUTE }),
    ]);

    expect(flow.income.total).toBe(0);
    expect(flow.expenses.total).toBe(0);
  });

  it.each([
    ['an exchange leg', { exchangeCounterpartHoldingId: 'card' }],
    ['a P2P purchase row', { untrackedCounterpart: 'p2p:UAH:4150.00' }],
    ['a bank purchase row', { untrackedCounterpart: 'bank:UAH:4150.00' }],
    ['a card purchase row', { untrackedCounterpart: 'card:UAH:4150.00' }],
  ])('leaves out %s, by its marker', (_name, marker) => {
    expect(incomeOf([rowOf('leg', 9_990_000, marker)])).toBe(0);
  });

  it('leaves out the credit leg of a same-currency move', () => {
    const flow = flowOf([
      rowOf('move-out', -70_000, { exchangePairId: 'pair' }),
      rowOf('move-in', 70_000, { exchangePairId: 'pair', holdingId: 'cash' }),
    ]);

    expect(flow.income.total).toBe(0);
  });

  it('leaves out a credit linked to a loan in its currency, on or after the loan start', () => {
    expect(incomeOf([rowOf('reversal', 12_000, { loanHoldingId: 'loan' })])).toBe(0);
  });

  it('drops an unrated crypto credit, as the charts drop an unrated debit', () => {
    const unrated = rowOf('unrated', TWO_AND_A_HALF_USDT, { holdingId: 'coin' });

    expect(flowOf([unrated], { rateTable: {} }).income.total).toBe(0);
  });

  it('counts a refund, a plain credit: a wrong value by the ruling', () => {
    expect(incomeOf([rowOf('refund', 20_000, { description: 'Refund' })])).toBe(20_000);
  });

  it('counts an own transfer that no rule catches: a wrong value by the ruling', () => {
    expect(incomeOf([rowOf('lone-credit', 80_000, { holdingId: 'cash' })])).toBe(80_000);
  });

  it.each(['Повернення депозиту', 'Виплата за облігаціями'])(
    'leaves out a credit described "%s": wrong for a payout',
    (description) => {
      expect(incomeOf([rowOf('payout', 30_000, { description })])).toBe(0);
    },
  );

  it.each([
    ['a cash-out MCC', { mcc: 6011 }],
    ['a card top-up MCC', { mcc: 6540 }],
    ['4829 from an own IBAN', { mcc: 4829, counterIban: OWN_IBAN }],
  ])('leaves out a credit with %s', (_name, overrides) => {
    expect(incomeOf([rowOf('credit', 30_000, overrides)])).toBe(0);
  });

  it('counts a 4829 credit from a third party', () => {
    const fromThirdParty = rowOf('credit', 30_000, { mcc: 4829, counterIban: 'UA00OTHER' });

    expect(incomeOf([fromThirdParty])).toBe(30_000);
  });

  it('counts loan proceeds that arrive as a plain credit: a wrong value by the ruling', () => {
    expect(incomeOf([rowOf('proceeds', 900_000, { description: 'Loan' })])).toBe(900_000);
  });

  it('counts a bank credit from a Binance fiat withdrawal: a wrong value by the ruling', () => {
    const flow = flowOf([
      // As the Binance sync writes a fiat withdrawal: the marked debit of the coin's Spot holding.
      rowOf('spot-debit', -60_000, { holdingId: 'fiat', untrackedCounterpart: 'bank:UAH:600.00' }),
      rowOf('bank-credit', 60_000, { time: BASE_TIME + MINUTE }),
    ]);

    expect(flow.income.total).toBe(60_000);
  });

  it('counts a bank credit from a P2P sale, which has no row on the other side', () => {
    expect(incomeOf([rowOf('sale', 415_000, { description: 'From P2P sale' })])).toBe(415_000);
  });
});

describe('buildCashFlow', () => {
  // January to March 2025.
  const MONTHS = calendarMonthsBetween(
    new Date(2025, 0, 10).getTime(),
    new Date(2025, 2, 10).getTime(),
  );
  const [JANUARY, FEBRUARY, MARCH] = MONTHS;
  const in2025 = (month: (typeof MONTHS)[number], id: string, amount: number) =>
    rowOf(id, amount, { time: month.start + 1_000, category: 'groceries' });

  const WORLD = [
    in2025(JANUARY, 'jan-in', 1_000_00),
    in2025(JANUARY, 'jan-out', -500_00),
    in2025(FEBRUARY, 'feb-in', 1_000_00),
    in2025(FEBRUARY, 'feb-out', -1_500_00),
    in2025(MARCH, 'mar-in', 5_000_00),
  ];

  // The last month is still running, and January is the first complete one.
  const flowOver = (overrides: Partial<FlowInput> = {}) =>
    flowOf(WORLD, { months: MONTHS, firstCompleteIndex: 0, currentIsPartial: true, ...overrides });

  it('gives each month its income, expenses and net, in base minor units', () => {
    const { income, expenses, net } = flowOver();

    expect(income.cells).toEqual([1_000_00, 1_000_00, 5_000_00]);
    expect(expenses.cells).toEqual([500_00, 1_500_00, 0]);
    expect(net.cells).toEqual([500_00, -500_00, 5_000_00]);
  });

  it('totals the period: income and expenses, and net as their difference', () => {
    const { income, expenses, net } = flowOver();

    expect(income.total).toBe(7_000_00);
    expect(expenses.total).toBe(2_000_00);
    expect(net.total).toBe(5_000_00);
  });

  it('averages the complete months only, not the running one', () => {
    const { income, expenses, net } = flowOver();

    expect(income.average).toBe(1_000_00);
    expect(expenses.average).toBe(1_000_00);
    expect(net.average).toBe(0);
  });

  it('averages the last month too once it is complete', () => {
    const { income } = flowOver({ currentIsPartial: false });

    expect(income.average).toBeCloseTo(7_000_00 / 3);
  });

  it('gives the savings rate as net over income: negative allowed, zero when net is zero', () => {
    const { savingsRate } = flowOver();

    expect(savingsRate.cells).toEqual([0.5, -0.5, 1]);
    expect(savingsRate.total).toBeCloseTo(5 / 7);
    // Net over the complete months is zero: a rate of zero, not null.
    expect(savingsRate.average).toBe(0);
  });

  it('gives the average rate over complete months as their total net over total income', () => {
    const { savingsRate } = flowOver({ currentIsPartial: false });

    expect(savingsRate.average).toBeCloseTo(5 / 7);
  });

  it('gives a null rate at zero income, never zero or infinity', () => {
    const { savingsRate, net } = flowOf([in2025(JANUARY, 'only-spend', -200_00)], {
      months: MONTHS,
      firstCompleteIndex: 0,
    });

    expect(net.total).toBe(-200_00);
    expect(savingsRate).toEqual({ cells: [null, null, null], total: null, average: null });
  });

  it('gives no average with no complete month', () => {
    const { income, expenses, net, savingsRate } = flowOver({ firstCompleteIndex: null });

    expect([income.average, expenses.average, net.average, savingsRate.average]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('keeps the cross-month transfer pair out of income, and out of expenses', () => {
    const flow = flowOf(
      [
        rowOf('out', -2_000_001, { time: JANUARY.end - 500 }),
        rowOf('in', 2_000_001, { holdingId: 'cash', time: JANUARY.end + 500 }),
      ],
      { months: MONTHS },
    );

    expect(flow.income.cells).toEqual([0, 0, 0]);
    expect(flow.expenses.cells).toEqual([0, 0, 0]);
  });

  it('leaves a negative balance-set row out of expenses, and a positive one out of income', () => {
    const flow = flowOf([
      rowOf('negative-opening', -50_000, { setsBalance: true }),
      rowOf('positive-opening', 70_000, { setsBalance: true, holdingId: 'cash' }),
    ]);

    expect(flow.expenses.total).toBe(0);
    expect(flow.income.total).toBe(0);
  });

  it('reads only the rows of the shown holdings', () => {
    const ledger = ledgerOf(
      [rowOf('card-in', 10_000), rowOf('cash-in', 90_000, { holdingId: 'cash' })],
      [CARD],
    );

    expect(flowOf([], { ledger }).income.total).toBe(10_000);
  });

  it('returns nothing for a period with no month', () => {
    const flow = flowOf([rowOf('salary', 50_000)], { months: [] });

    expect(flow.income).toEqual({ cells: [], total: 0, average: null });
    expect(flow.savingsRate).toEqual({ cells: [], total: null, average: null });
  });
});
