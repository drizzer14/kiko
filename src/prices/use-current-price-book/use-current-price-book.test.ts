import { renderHook } from '@testing-library/react-native';

const mockUseLiveQuery = jest.fn();
const mockCurrentQuery = jest.fn();
const mockAllQuery = jest.fn();
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/prices/price-points-repo', () => ({
  pricePointsRepo: {
    currentQuery: (...args: unknown[]) => mockCurrentQuery(...args),
    allQuery: (...args: unknown[]) => mockAllQuery(...args),
  },
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    loanLedgerPaymentsQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));

import { useCurrentPriceBook } from './use-current-price-book';

const CURRENT_QUERY = { toSQL: () => ({ sql: 'current', params: [] }) };

describe('useCurrentPriceBook', () => {
  beforeEach(() => {
    mockUseLiveQuery.mockReset();
    mockCurrentQuery.mockReset();
    mockAllQuery.mockReset();
    mockCurrentQuery.mockReturnValue(CURRENT_QUERY);
    mockUseLiveQuery.mockReturnValue({ data: [], isLoading: false });
  });

  it('reads the current rows for the local day of the given instant, never the whole table', async () => {
    await renderHook(() =>
      useCurrentPriceBook(true, {}, true, new Date(2026, 2, 30, 0, 5).getTime()),
    );

    expect(mockCurrentQuery).toHaveBeenCalledWith(Date.UTC(2026, 2, 30));
    expect(mockAllQuery).not.toHaveBeenCalled();
    expect(mockUseLiveQuery).toHaveBeenCalledWith(CURRENT_QUERY, ['price_points'], true, {});
  });

  it('reads the current rows for today when no instant is given', async () => {
    await renderHook(() => useCurrentPriceBook());

    const [today] = mockCurrentQuery.mock.calls[0];
    const now = new Date();

    expect(today).toBe(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  });

  it('forwards enabled, the cache option and the narrowed payments read like the whole-table hook', async () => {
    await renderHook(() => useCurrentPriceBook(false, { cached: true }, false));

    expect(mockUseLiveQuery).toHaveBeenCalledWith(CURRENT_QUERY, ['price_points'], false, {
      cached: true,
    });
    expect(mockUseLiveQuery).toHaveBeenCalledWith(
      expect.anything(),
      ['transactions', 'holdings'],
      false,
      { cached: true },
    );
  });

  it('builds the book from the current rows and the linked payments', async () => {
    mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) =>
      tables[0] === 'price_points'
        ? {
            data: [
              { instrument: 'share:AAPL', day: 1, price: '190', currency: 'USD', source: 'eodhd' },
            ],
            isLoading: false,
          }
        : {
            data: [{ loanHoldingId: 'loan-1', time: 5, amountMinorUnits: -100, currency: 'UAH' }],
            isLoading: true,
          },
    );

    const { result } = await renderHook(() => useCurrentPriceBook());

    expect(result.current.book.points.get('share:AAPL')?.[0].price).toBe('190');
    expect(result.current.book.loanPayments.get('loan-1')).toHaveLength(1);
    expect(result.current.isLoading).toBe(true);
  });
});
