import { renderHook } from '@testing-library/react-native';

const mockUseLiveQuery = jest.fn();
const mockOpenCurrenciesQuery = jest.fn();
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    openCurrenciesQuery: (...args: unknown[]) => mockOpenCurrenciesQuery(...args),
  },
}));

import { useHeldCurrencies } from './use-held-currencies';

const OPEN_CURRENCIES_QUERY = { toSQL: () => ({ sql: 'open-currencies', params: [] }) };

describe('useHeldCurrencies', () => {
  beforeEach(() => {
    mockUseLiveQuery.mockReset();
    mockOpenCurrenciesQuery.mockReset();
    mockOpenCurrenciesQuery.mockReturnValue(OPEN_CURRENCIES_QUERY);
  });

  it('reads openCurrenciesQuery on holdings and accounts', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [], isLoading: false });

    await renderHook(() => useHeldCurrencies());

    expect(mockUseLiveQuery).toHaveBeenCalledWith(OPEN_CURRENCIES_QUERY, ['holdings', 'accounts']);
  });

  it('maps the rows to their currency codes', async () => {
    mockUseLiveQuery.mockReturnValue({
      data: [{ currency: 'USD' }, { currency: 'BTC' }],
      isLoading: false,
    });

    const { result } = await renderHook(() => useHeldCurrencies());

    expect(result.current).toEqual(['USD', 'BTC']);
  });

  it('returns [] while loading', async () => {
    mockUseLiveQuery.mockReturnValue({ data: [{ currency: 'USD' }], isLoading: true });

    const { result } = await renderHook(() => useHeldCurrencies());

    expect(result.current).toEqual([]);
  });
});
