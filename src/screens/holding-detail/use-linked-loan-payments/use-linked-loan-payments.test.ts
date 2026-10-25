import type { TransactionRow } from '@kiko/db';
import { renderHook } from '@testing-library/react-native';

import { useLinkedLoanPayments } from './use-linked-loan-payments';

const mockUseLiveQuery = jest.fn();
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));

jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    listLinkedToLoanQuery: (loanHoldingId: string) => ({
      toSQL: () => ({ sql: 'linked-loan-payments', params: [loanHoldingId] }),
    }),
  },
}));

const PAYMENT = { id: 'txn-1' } as TransactionRow;

describe('useLinkedLoanPayments', () => {
  beforeEach(() => {
    mockUseLiveQuery.mockReset();
  });

  it('reads the payments linked to a loan, and whether they are still loading', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [PAYMENT], isLoading: true });

    const { result } = await renderHook(() => useLinkedLoanPayments('loan-1', true));

    expect(result.current).toEqual({ payments: [PAYMENT], isLoading: true });
    expect(mockUseLiveQuery).toHaveBeenCalledWith(
      expect.objectContaining({ toSQL: expect.any(Function) }),
      ['transactions'],
      true,
      { cached: true },
    );
  });

  it('skips the read for a holding that is not a loan', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [], isLoading: false });

    await renderHook(() => useLinkedLoanPayments('card-1', false));

    expect(mockUseLiveQuery).toHaveBeenCalledWith(
      expect.anything(),
      ['transactions'],
      false,
      expect.anything(),
    );
  });

  it('hands a holding that is not a loan the same empty list on every render', async () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [], isLoading: false }));

    const { result, rerender } = await renderHook(() => useLinkedLoanPayments('card-1', false));
    const before = result.current.payments;

    await rerender({});

    expect(result.current.payments).toBe(before);
    expect(before).toEqual([]);
  });

  it('never lists a payment for a holding that is not a loan, even if the read answered with one', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [PAYMENT], isLoading: false });

    const { result } = await renderHook(() => useLinkedLoanPayments('card-1', false));

    expect(result.current.payments).toEqual([]);
  });
});
