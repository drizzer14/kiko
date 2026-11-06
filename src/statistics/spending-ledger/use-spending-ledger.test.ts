import { renderHook } from '@testing-library/react-native';
import { exchangeFundingMatches } from '@kiko/statistics/exchange-funding-match';
import { internalTransferTransactionIds } from '@kiko/statistics/internal-transfers';
import { sameCurrencyMoveTransactionIds } from '@kiko/statistics/exchange-exclusion';

import {
  BASE_TIME,
  CARD,
  CASH,
  LOAN_PAYMENT,
  MINUTE,
  transactionRow,
  worldInput,
  WORLD_TRANSACTIONS,
} from './__fixtures__/spending-ledger-world';
import { buildSpendingLedger, useSpendingLedger } from '.';

jest.mock('@kiko/statistics/internal-transfers', () => {
  const actual: typeof import('@kiko/statistics/internal-transfers') = jest.requireActual(
    '@kiko/statistics/internal-transfers',
  );

  return {
    ...actual,
    internalTransferTransactionIds: jest.fn(actual.internalTransferTransactionIds),
  };
});
jest.mock('@kiko/statistics/exchange-exclusion', () => {
  const actual: typeof import('@kiko/statistics/exchange-exclusion') = jest.requireActual(
    '@kiko/statistics/exchange-exclusion',
  );

  return {
    ...actual,
    sameCurrencyMoveTransactionIds: jest.fn(actual.sameCurrencyMoveTransactionIds),
  };
});
jest.mock('@kiko/statistics/exchange-funding-match', () => {
  const actual: typeof import('@kiko/statistics/exchange-funding-match') = jest.requireActual(
    '@kiko/statistics/exchange-funding-match',
  );

  return { ...actual, exchangeFundingMatches: jest.fn(actual.exchangeFundingMatches) };
});

const BALANCE_SET = transactionRow({
  id: 'balance-set',
  holdingId: 'card',
  amountMinorUnits: -50_000,
  setsBalance: true,
});
const CASH_BALANCE_SET = transactionRow({
  id: 'cash-balance-set',
  holdingId: 'cash',
  amountMinorUnits: -70_000,
  setsBalance: true,
});
const MARKED_LOAN_PAYMENT = transactionRow({
  ...LOAN_PAYMENT,
  id: 'marked-loan-payment',
  setsBalance: true,
  time: LOAN_PAYMENT.time - 1,
});

describe('useSpendingLedger', () => {
  it('gives every field the builder gives, on the same world', async () => {
    const input = worldInput({ transactions: [...WORLD_TRANSACTIONS, BALANCE_SET] });
    const { result } = await renderHook(() => useSpendingLedger(input));
    const built = buildSpendingLedger(input);

    expect(Object.keys(result.current).sort()).toEqual(Object.keys(built).sort());

    for (const key of Object.keys(built) as (keyof typeof built)[]) {
      expect({ key, value: result.current[key] }).toEqual({ key, value: built[key] });
    }
  });

  it('gives the builder output on a filtered account list too', async () => {
    const input = worldInput({
      shownHoldings: [CARD],
      transactions: [...WORLD_TRANSACTIONS, CASH_BALANCE_SET],
    });
    const { result } = await renderHook(() => useSpendingLedger(input));

    expect(result.current).toEqual(buildSpendingLedger(input));
    expect(result.current.excludedTransactionIds.has('cash-balance-set')).toBe(true);
  });

  it('counts a real debit a marked credit would have cancelled, as the builder does', async () => {
    const realDebit = transactionRow({
      id: 'real-debit',
      holdingId: 'card',
      amountMinorUnits: -6_000,
      time: BASE_TIME + 20 * MINUTE,
    });
    const setCredit = transactionRow({
      id: 'set-credit',
      holdingId: 'cash',
      amountMinorUnits: 6_000,
      setsBalance: true,
      time: BASE_TIME + 20 * MINUTE + 1_000,
    });
    const input = worldInput({ transactions: [...WORLD_TRANSACTIONS, setCredit, realDebit] });
    const { result } = await renderHook(() => useSpendingLedger(input));

    expect(result.current.excludedTransactionIds.has('real-debit')).toBe(false);
    expect(result.current).toEqual(buildSpendingLedger(input));
  });

  it('derives no loan entry for a marked row linked to a loan', async () => {
    const input = worldInput({ transactions: [...WORLD_TRANSACTIONS, MARKED_LOAN_PAYMENT] });
    const { result } = await renderHook(() => useSpendingLedger(input));
    const trendIds = result.current.trendTransactions.map((row) => row.id);

    expect(trendIds.filter((id) => id.endsWith(':marked-loan-payment'))).toEqual([]);
    expect(trendIds).toContain('loan-interest:loan-payment');
  });

  it('does not rerun a ledger-wide matcher when only the shown holdings change', async () => {
    const input = worldInput();
    const { result, rerender } = await renderHook(
      (props: typeof input) => useSpendingLedger(props),
      { initialProps: input },
    );
    const firstLedger = result.current.ledgerWithCurrency;
    const calls = {
      transfers: jest.mocked(internalTransferTransactionIds).mock.calls.length,
      moves: jest.mocked(sameCurrencyMoveTransactionIds).mock.calls.length,
      funding: jest.mocked(exchangeFundingMatches).mock.calls.length,
    };

    await rerender({ ...input, shownHoldings: [CASH] });

    expect(result.current.ledgerWithCurrency).toBe(firstLedger);
    expect(jest.mocked(internalTransferTransactionIds).mock.calls).toHaveLength(calls.transfers);
    expect(jest.mocked(sameCurrencyMoveTransactionIds).mock.calls).toHaveLength(calls.moves);
    expect(jest.mocked(exchangeFundingMatches).mock.calls).toHaveLength(calls.funding);
  });

  it('reruns the ledger-wide matchers when a transaction arrives', async () => {
    const input = worldInput();
    const { rerender } = await renderHook((props: typeof input) => useSpendingLedger(props), {
      initialProps: input,
    });
    const before = jest.mocked(internalTransferTransactionIds).mock.calls.length;

    await rerender({
      ...input,
      transactions: [...input.transactions, transactionRow({ id: 'late', holdingId: 'card' })],
    });

    expect(jest.mocked(internalTransferTransactionIds).mock.calls.length).toBeGreaterThan(before);
  });
});
