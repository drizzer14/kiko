import { buildCategoryTrend } from '../category-trend';
import { buildCategoryBreakdown } from '../category-breakdown';

import {
  buildSpendingLedger,
  excludedIdsOf,
  type LedgerRow,
  spendingRowsIn,
  type SpendingLedger,
} from '.';
import {
  BANK,
  BASE_TIME,
  CARD,
  CASH,
  COUNTED,
  CRYPTO,
  EXCLUDED_BY_ONE_RULE_EACH,
  LOAN_PAYMENT,
  MINUTE,
  transactionRow,
  worldInput,
  WORLD_TRANSACTIONS,
} from './__fixtures__/spending-ledger-world';

const idsOf = (rows: readonly { id: string }[]): string[] => rows.map((row) => row.id);

describe('buildSpendingLedger', () => {
  it('excludes one row for each of the seven rule sets and keeps an ordinary expense', () => {
    const { excludedTransactionIds } = buildSpendingLedger(worldInput());

    expect([...excludedTransactionIds].sort()).toEqual([...EXCLUDED_BY_ONE_RULE_EACH].sort());
    expect(excludedTransactionIds.has(COUNTED.id)).toBe(false);
  });

  it('keeps every holding in the ledger and only the shown holdings in the shown rows', () => {
    const ledger = buildSpendingLedger(worldInput({ shownHoldings: [CARD] }));

    expect(idsOf(ledger.ledgerWithCurrency)).toEqual(idsOf(WORLD_TRANSACTIONS));
    expect(idsOf(ledger.shownRows)).toEqual(
      WORLD_TRANSACTIONS.filter((row) => row.holdingId === 'card').map((row) => row.id),
    );
    expect(ledger.ledgerWithCurrency.map((row: LedgerRow) => row.currency)).toContain('USDT');
  });

  it('drops a row whose holding is not in the list', () => {
    const orphan = transactionRow({ id: 'orphan', holdingId: 'gone' });
    const ledger = buildSpendingLedger(
      worldInput({ transactions: [...WORLD_TRANSACTIONS, orphan] }),
    );

    expect(idsOf(ledger.ledgerWithCurrency)).not.toContain('orphan');
  });

  it("still excludes a shown leg whose transfer partner sits under a filtered-out account's holding", () => {
    const ledger = buildSpendingLedger(worldInput({ shownHoldings: [CARD] }));

    expect(idsOf(ledger.shownRows)).not.toContain('transfer-in');
    expect(ledger.excludedTransactionIds.has('transfer-out')).toBe(true);
    expect(ledger.excludedTransactionIds.has('move-out')).toBe(true);
  });

  it('still excludes a funding debit when the account filter hides the crypto account', () => {
    const ledger = buildSpendingLedger(worldInput({ shownHoldings: [CARD] }));

    expect(ledger.excludedTransactionIds.has('funding-debit')).toBe(true);
  });

  it('counts a bank debit no exchange purchase matches', () => {
    const ledger = buildSpendingLedger(
      worldInput({ transactions: WORLD_TRANSACTIONS.filter((row) => row.id !== 'coin-purchase') }),
    );

    expect(ledger.excludedTransactionIds.has('funding-debit')).toBe(false);
  });

  it('puts the loan payment interest entry in the trend rows after the real rows', () => {
    const { trendTransactions, breakdownTransactions } = buildSpendingLedger(worldInput());
    const interest = trendTransactions.find((row) => row.id === 'loan-interest:loan-payment');

    expect(interest).toMatchObject({
      category: 'loan_interest',
      amountMinorUnits: -9_000,
      currency: 'UAH',
      time: LOAN_PAYMENT.time,
    });
    expect(idsOf(trendTransactions).slice(0, WORLD_TRANSACTIONS.length)).toEqual(
      idsOf(WORLD_TRANSACTIONS),
    );
    expect(idsOf(breakdownTransactions)).toEqual(idsOf(WORLD_TRANSACTIONS));
  });

  it('carries the time on a trend row and not on a breakdown row', () => {
    const { trendTransactions, breakdownTransactions } = buildSpendingLedger(worldInput());

    expect(trendTransactions[0].time).toBe(COUNTED.time);
    expect(breakdownTransactions[0]).not.toHaveProperty('time');
  });
});

describe('excludedIdsOf', () => {
  it('unions every rule set it is given', () => {
    const union = excludedIdsOf({
      internalTransferIds: new Set(['internal']),
      mccExcludedIds: new Set(['mcc']),
      descriptionExcludedIds: new Set(['description']),
      exchangeExcludedIds: new Set(['exchange']),
      sameCurrencyMoveIds: new Set(['same-currency']),
      exchangeFundingExcludedIds: new Set(['funding']),
      loanPaymentExcludedIds: new Set(['loan']),
      balanceSetIds: new Set(['balance-set']),
    });

    expect([...union].sort()).toEqual([
      'balance-set',
      'description',
      'exchange',
      'funding',
      'internal',
      'loan',
      'mcc',
      'same-currency',
    ]);
  });
});

describe('a row that sets a balance', () => {
  const BALANCE_SET = transactionRow({
    id: 'balance-set',
    holdingId: 'card',
    amountMinorUnits: -50_000,
    category: 'opening',
    setsBalance: true,
    time: BASE_TIME + 5 * MINUTE,
  });
  const UNMARKED_TWIN = transactionRow({
    id: 'unmarked-twin',
    holdingId: 'card',
    amountMinorUnits: -50_000,
    category: 'opening',
    time: BASE_TIME + 6 * MINUTE,
  });
  const POSITIVE_BALANCE_SET = transactionRow({
    id: 'positive-balance-set',
    holdingId: 'card',
    amountMinorUnits: 50_000,
    category: 'opening',
    setsBalance: true,
    time: BASE_TIME + 7 * MINUTE,
  });
  const categoryDisplay = new Map([
    ['opening', { title: 'Opening', icon: 'tray', color: null }],
    ['groceries', { title: 'Groceries', icon: 'cart', color: null }],
    ['other', { title: 'Other', icon: 'ellipsis', color: null }],
  ]);
  const range = { from: BASE_TIME, to: BASE_TIME + 200 * MINUTE };

  const donutOf = (ledger: SpendingLedger) =>
    buildCategoryBreakdown({
      transactions: spendingRowsIn(ledger, range.from, range.to),
      categoryDisplay,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      excludedTransactionIds: ledger.excludedTransactionIds,
    });
  const trendOf = (ledger: SpendingLedger) =>
    buildCategoryTrend({
      transactions: ledger.trendTransactions,
      categoryDisplay,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      range,
      bucketDays: 1,
      excludedTransactionIds: ledger.excludedTransactionIds,
    });
  const worldWith = (...rows: ReturnType<typeof transactionRow>[]) =>
    buildSpendingLedger(worldInput({ transactions: [...WORLD_TRANSACTIONS, ...rows] }));

  it('is excluded from spending when negative', () => {
    expect(worldWith(BALANCE_SET).excludedTransactionIds.has('balance-set')).toBe(true);
  });

  it('is out of the donut and the trend', () => {
    const ledger = worldWith(BALANCE_SET);

    expect(donutOf(ledger).map((slice) => slice.key)).not.toContain('opening');
    expect(trendOf(ledger).map((series) => series.key)).not.toContain('opening');
  });

  it('derives no loan entry for a marked row linked to a loan', () => {
    const linked = transactionRow({
      ...LOAN_PAYMENT,
      id: 'marked-loan-payment',
      setsBalance: true,
      time: BASE_TIME + 8 * MINUTE,
    });
    const ledger = worldWith(linked);
    const trendIds = idsOf(ledger.trendTransactions);
    const rangeIds = idsOf(spendingRowsIn(ledger, range.from, range.to));

    expect(trendIds.filter((id) => id.endsWith(':marked-loan-payment'))).toEqual([]);
    expect(rangeIds.filter((id) => id.endsWith(':marked-loan-payment'))).toEqual([]);
    expect(trendIds).toContain('loan-interest:loan-payment');
    expect(rangeIds).toContain('loan-interest:loan-payment');
  });

  it('leaves an unmarked row of the same amount counted', () => {
    const ledger = worldWith(BALANCE_SET, UNMARKED_TWIN);

    expect(ledger.excludedTransactionIds.has('unmarked-twin')).toBe(false);
    expect(donutOf(ledger).find((slice) => slice.key === 'opening')?.amount).toBe(50_000);
    expect(trendOf(ledger).find((series) => series.key === 'opening')).toBeDefined();
  });

  it('adds nothing to spending when it is positive', () => {
    const ledger = worldWith(POSITIVE_BALANCE_SET);

    expect(donutOf(ledger).map((slice) => slice.key)).not.toContain('opening');
  });

  describe('beside a real row of the opposite sign', () => {
    const REAL_DEBIT = transactionRow({
      id: 'real-debit',
      holdingId: 'card',
      amountMinorUnits: -6_000,
      category: 'groceries',
      time: BASE_TIME + 20 * MINUTE,
    });
    const SET_CREDIT = transactionRow({
      id: 'set-credit',
      holdingId: 'cash',
      amountMinorUnits: 6_000,
      setsBalance: true,
      time: BASE_TIME + 20 * MINUTE + 1_000,
    });
    const MOVE_DEBIT = transactionRow({
      ...REAL_DEBIT,
      id: 'move-debit',
      amountMinorUnits: -8_000,
      exchangePairId: 'pair-2',
    });
    const SET_MOVE_CREDIT = transactionRow({
      ...SET_CREDIT,
      id: 'set-move-credit',
      amountMinorUnits: 8_000,
      exchangePairId: 'pair-2',
    });
    const MARKED_PURCHASE = transactionRow({
      id: 'marked-purchase',
      holdingId: 'coin',
      amountMinorUnits: 9_990_000_000,
      untrackedCounterpart: 'p2p:UAH:4150.00',
      setsBalance: true,
      time: BASE_TIME + 120 * MINUTE,
    });
    const NEARER_SET_DEBIT = transactionRow({
      id: 'nearer-set-debit',
      holdingId: 'cash',
      amountMinorUnits: -415_000,
      setsBalance: true,
      time: BASE_TIME + 110 * MINUTE,
    });
    // The trend carries major units, the donut minor ones.
    const totalOf = (minorUnits: number) => ({ donut: minorUnits, trend: minorUnits / 100 });
    const GROCERIES_BEFORE = totalOf(1_500);
    // The world's loan payment leaves its interest entry in the uncategorized slice.
    const LOAN_INTEREST = 9_000;
    const otherOf = (ledger: SpendingLedger) =>
      donutOf(ledger).find((slice) => slice.key === 'other')?.amount;
    const sumOf = (amounts: number[]) => amounts.reduce((total, amount) => total + amount, 0);
    const groceriesOf = (ledger: SpendingLedger) => ({
      donut: donutOf(ledger).find((slice) => slice.key === 'groceries')?.amount,
      trend: sumOf(
        trendOf(ledger)
          .find((series) => series.key === 'groceries')
          ?.points.map((point) => point.amount) ?? [],
      ),
    });

    it('counts a real debit a marked credit would have cancelled', () => {
      const ledger = worldWith(SET_CREDIT, REAL_DEBIT);

      expect(ledger.excludedTransactionIds.has('real-debit')).toBe(false);
      expect(groceriesOf(ledger)).toEqual(totalOf(7_500));
    });

    it('still pairs the same two rows when neither is marked', () => {
      const ledger = worldWith({ ...SET_CREDIT, setsBalance: false }, REAL_DEBIT);

      expect(ledger.excludedTransactionIds.has('real-debit')).toBe(true);
      expect(ledger.excludedTransactionIds.has('set-credit')).toBe(true);
      expect(groceriesOf(ledger)).toEqual(GROCERIES_BEFORE);
    });

    it('does not pair a marked partner under a holding the account filter hides', () => {
      const ledger = buildSpendingLedger(
        worldInput({
          transactions: [...WORLD_TRANSACTIONS, SET_CREDIT, REAL_DEBIT],
          shownHoldings: [CARD],
        }),
      );

      expect(ledger.excludedTransactionIds.has('real-debit')).toBe(false);
      expect(groceriesOf(ledger)).toEqual(totalOf(7_500));
    });

    it('counts a real debit of a pair id whose credit is marked', () => {
      const ledger = worldWith(SET_MOVE_CREDIT, MOVE_DEBIT);

      expect(ledger.excludedTransactionIds.has('move-debit')).toBe(false);
      expect(groceriesOf(ledger)).toEqual(totalOf(9_500));
    });

    it('pairs a pair id of two unmarked legs', () => {
      const ledger = worldWith({ ...SET_MOVE_CREDIT, setsBalance: false }, MOVE_DEBIT);

      expect(ledger.excludedTransactionIds.has('move-debit')).toBe(true);
      expect(ledger.excludedTransactionIds.has('set-move-credit')).toBe(true);
      expect(groceriesOf(ledger)).toEqual(GROCERIES_BEFORE);
    });

    it('counts a bank debit whose exchange purchase row is marked', () => {
      const withoutPurchase = WORLD_TRANSACTIONS.filter((row) => row.id !== 'coin-purchase');
      const ledger = buildSpendingLedger(
        worldInput({ transactions: [...withoutPurchase, MARKED_PURCHASE] }),
      );

      expect(ledger.excludedTransactionIds.has('funding-debit')).toBe(false);
      expect(otherOf(ledger)).toBe(LOAN_INTEREST + 415_000);
    });

    it('leaves the funding match to a real debit when a marked debit is nearer', () => {
      const ledger = worldWith(NEARER_SET_DEBIT);

      expect(ledger.excludedTransactionIds.has('funding-debit')).toBe(true);
      expect(otherOf(ledger)).toBe(LOAN_INTEREST);
    });
  });

  it('stays out of spending when the account filter hides its holding', () => {
    const ledger = buildSpendingLedger(
      worldInput({
        transactions: [...WORLD_TRANSACTIONS, { ...BALANCE_SET, holdingId: 'cash' }],
        shownHoldings: [CARD],
      }),
    );

    expect(ledger.excludedTransactionIds.has('balance-set')).toBe(true);
  });
});

describe('spendingRowsIn', () => {
  const ledger = buildSpendingLedger(worldInput());

  it('keeps both bounds', () => {
    const rows = spendingRowsIn(ledger, BASE_TIME + 30 * MINUTE, BASE_TIME + 40 * MINUTE);

    expect(idsOf(rows)).toEqual(['transfer-out', 'transfer-in', 'cash-out']);
  });

  it('drops a row one millisecond outside either bound', () => {
    const rows = spendingRowsIn(ledger, BASE_TIME + 30 * MINUTE + 1, BASE_TIME + 40 * MINUTE - 1);

    expect(idsOf(rows)).toEqual(['transfer-in']);
  });

  it('lists the shown rows in ledger order, then the loan entries', () => {
    const rows = spendingRowsIn(ledger, BASE_TIME, BASE_TIME + 200 * MINUTE);

    expect(idsOf(rows)).toEqual([...idsOf(WORLD_TRANSACTIONS), 'loan-interest:loan-payment']);
  });

  it('range-filters a loan entry the way it filters the payment row it replaces', () => {
    const rows = spendingRowsIn(ledger, BASE_TIME, LOAN_PAYMENT.time - 1);

    expect(idsOf(rows)).not.toContain('loan-interest:loan-payment');
    expect(idsOf(rows)).not.toContain('loan-payment');
  });

  it('reads only the shown holdings', () => {
    const narrowed = buildSpendingLedger(worldInput({ shownHoldings: [CASH] }));

    expect(idsOf(spendingRowsIn(narrowed, BASE_TIME, BASE_TIME + 200 * MINUTE))).toEqual([
      'transfer-in',
      'move-in',
    ]);
  });

  it('shows nothing for a world with no rows', () => {
    const empty = buildSpendingLedger(worldInput({ transactions: [], accounts: [BANK, CRYPTO] }));

    expect(spendingRowsIn(empty, 0, Number.MAX_SAFE_INTEGER)).toEqual([]);
  });
});
