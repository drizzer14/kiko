import { renderHook } from '@testing-library/react-native';

const mockUseLiveQuery = jest.fn();
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    balanceBoundaryQuery: (holdingId: string) => ({ __kind: 'boundary', holdingId }),
  },
}));

import { useBalanceBoundary } from './use-balance-boundary';

describe('useBalanceBoundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('takes the later of the balance set and the newest synced row', async () => {
    mockUseLiveQuery.mockReturnValue({
      data: [{ balanceSetAt: 500, newestSyncTime: 900 }],
      isLoading: false,
    });

    const { result } = await renderHook(() => useBalanceBoundary('card', true));

    expect(result.current).toEqual({ boundary: 900, isLoading: false });
  });

  it('reads no boundary for a holding that has neither', async () => {
    mockUseLiveQuery.mockReturnValue({
      data: [{ balanceSetAt: null, newestSyncTime: null }],
      isLoading: false,
    });

    const { result } = await renderHook(() => useBalanceBoundary('card', true));

    expect(result.current.boundary).toBeNull();
  });

  it('reads no boundary before the holding row has loaded', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [], isLoading: true });

    const { result } = await renderHook(() => useBalanceBoundary('card', true));

    expect(result.current).toEqual({ boundary: null, isLoading: true });
  });

  it('subscribes to the holding it was given, on the holdings and transactions tables', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [], isLoading: false });

    await renderHook(() => useBalanceBoundary('card', true));

    expect(mockUseLiveQuery).toHaveBeenCalledWith(
      { __kind: 'boundary', holdingId: 'card' },
      ['holdings', 'transactions'],
      true,
    );
  });

  it('passes the disabled flag on, so a row that never needs the boundary runs no query', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [], isLoading: false });

    await renderHook(() => useBalanceBoundary('card', false));

    expect(mockUseLiveQuery).toHaveBeenCalledWith(expect.anything(), expect.anything(), false);
  });
});
