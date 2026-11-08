import { Money } from '@kiko/currency/money';
import type { TransactionRow } from '@kiko/db';
import {
  BASE_TIME,
  transactionRow,
  worldInput,
} from '@kiko/statistics/spending-ledger/__fixtures__/spending-ledger-world';

import { buildSpendingLedger } from '../spending-ledger';

import { incomeAmountOf } from '.';

// 2.5 USDT, which is UAH 100 at the rate below.
const TWO_AND_A_HALF_USDT = 250_000_000;
const RATE_TABLE = { USDT: 40 };

const rowOf = (id: string, amountMinorUnits: number, overrides: Partial<TransactionRow> = {}) =>
  transactionRow({ id, holdingId: 'card', amountMinorUnits, time: BASE_TIME, ...overrides });

const rowsOf = (transactions: TransactionRow[]) =>
  buildSpendingLedger(worldInput({ transactions })).shownRows;

describe('incomeAmountOf', () => {
  it('is the amount of an income row in the base currency', () => {
    const [salary] = rowsOf([rowOf('salary', 50_000)]);

    expect(incomeAmountOf(salary, new Set(), RATE_TABLE, 'UAH')).toEqual(Money.of('UAH', 50_000));
  });

  it('converts another currency at the rate', () => {
    const [coin] = rowsOf([rowOf('coin', TWO_AND_A_HALF_USDT, { holdingId: 'coin' })]);

    expect(incomeAmountOf(coin, new Set(), RATE_TABLE, 'UAH')).toEqual(Money.of('UAH', 10_000));
  });

  it('is nothing for a debit', () => {
    const [debit] = rowsOf([rowOf('debit', -50_000)]);

    expect(incomeAmountOf(debit, new Set(), RATE_TABLE, 'UAH')).toBeUndefined();
  });

  it('is nothing for a credit that a rule excluded', () => {
    const [salary] = rowsOf([rowOf('salary', 50_000)]);

    expect(incomeAmountOf(salary, new Set(['salary']), RATE_TABLE, 'UAH')).toBeUndefined();
  });

  it('is nothing for a currency with no rate', () => {
    const [coin] = rowsOf([rowOf('coin', TWO_AND_A_HALF_USDT, { holdingId: 'coin' })]);

    expect(incomeAmountOf(coin, new Set(), {}, 'UAH')).toBeUndefined();
  });
});
