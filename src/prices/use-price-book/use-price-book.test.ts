import { renderHook } from '@testing-library/react-native';

const mockUseLiveQuery = jest.fn();
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('../price-points-repo', () => ({
  pricePointsRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

import { usePriceBook } from './use-price-book';

describe('usePriceBook', () => {
  it('subscribes to the price_points table', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [], isLoading: false });

    await renderHook(() => usePriceBook());

    expect(mockUseLiveQuery).toHaveBeenCalledWith(expect.anything(), ['price_points'], true, {});
  });

  // kiko-architecture: only a display screen reads the live-query cache, so
  // the opt-in is the caller's, forwarded as-is; a form passes nothing.
  it('forwards the cache opt-in straight through to useLiveQuery', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [], isLoading: false });

    await renderHook(() => usePriceBook(true, { cached: true }));

    expect(mockUseLiveQuery).toHaveBeenCalledWith(expect.anything(), ['price_points'], true, {
      cached: true,
    });
  });

  // kiko-architecture: a screen showing no priced holding type never needs
  // the price_points read — usePriceBook forwards its own `enabled` straight
  // through to useLiveQuery's `enabled` argument (never a conditional hook
  // call, which Rules of Hooks forbids).
  it('forwards enabled=false straight through to useLiveQuery', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [], isLoading: false });

    await renderHook(() => usePriceBook(false));

    expect(mockUseLiveQuery).toHaveBeenCalledWith(expect.anything(), ['price_points'], false, {});
  });

  it('builds a PriceBook from the live rows', async () => {
    mockUseLiveQuery.mockReturnValue({
      data: [
        { instrument: 'share:AAPL', day: 1, price: '190.00', currency: 'USD', source: 'eodhd' },
      ],
      isLoading: false,
    });

    const { result } = await renderHook(() => usePriceBook());

    expect(result.current.book.get('share:AAPL')?.[0].price).toBe('190.00');
  });

  it('returns an empty PriceBook before any row has loaded', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [], isLoading: true });

    const { result } = await renderHook(() => usePriceBook());

    expect(result.current.book.size).toBe(0);
  });

  it('threads isLoading straight through from the underlying live query', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [], isLoading: true });

    const { result } = await renderHook(() => usePriceBook());

    expect(result.current.isLoading).toBe(true);
  });
});
