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
    mockUseLiveQuery.mockReturnValue({ data: [] });

    await renderHook(() => usePriceBook());

    expect(mockUseLiveQuery).toHaveBeenCalledWith(expect.anything(), ['price_points']);
  });

  it('builds a PriceBook from the live rows', async () => {
    mockUseLiveQuery.mockReturnValue({
      data: [
        { instrument: 'share:AAPL', day: 1, price: '190.00', currency: 'USD', source: 'eodhd' },
      ],
    });

    const { result } = await renderHook(() => usePriceBook());

    expect(result.current.get('share:AAPL')?.[0].price).toBe('190.00');
  });

  it('returns an empty PriceBook before any row has loaded', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [] });

    const { result } = await renderHook(() => usePriceBook());

    expect(result.current.size).toBe(0);
  });
});
