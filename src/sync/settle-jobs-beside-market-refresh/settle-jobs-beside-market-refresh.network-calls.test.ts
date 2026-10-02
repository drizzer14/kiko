// The REAL refresh runs here (`refreshMarketData` into `refreshRates`); only the
// provider clients, the database and the share/metal steps are doubles, so what
// is counted is the requests one `settleJobsBesideMarketRefresh` run makes.
const mockFetchFiat = jest.fn();
const mockFetchNbu = jest.fn();
const mockFetchCrypto = jest.fn();
const mockOpenCurrencies = jest.fn();

jest.mock('@kiko/rates/monobank-rates', () => ({
  fetchFiatRates: (...args: unknown[]) => mockFetchFiat(...args),
}));
jest.mock('@kiko/rates/nbu-rates', () => ({
  fetchNbuFiatRates: (...args: unknown[]) => mockFetchNbu(...args),
}));
jest.mock('@kiko/rates/coingecko', () => ({
  fetchCryptoPrices: (...args: unknown[]) => mockFetchCrypto(...args),
}));
jest.mock('@kiko/rates/open-currencies-gate', () => ({
  openCurrencies: (...args: unknown[]) => mockOpenCurrencies(...args),
}));

const mockStoredRates = new Map<string, number>();

jest.mock('@kiko/rates/repo', () => ({
  ratesRepo: {
    latestFetchedAt: async () =>
      mockStoredRates.size === 0 ? null : Math.max(...mockStoredRates.values()),
    presentCurrenciesQuery: async () =>
      [...mockStoredRates.keys()].map((currency) => ({ currency })),
    upsertMany: async (rates: { base: string; fetchedAt: number }[]) => {
      for (const rate of rates) {
        mockStoredRates.set(rate.base, rate.fetchedAt);
      }
    },
  },
}));

const mockHeldCurrencies = new Set<string>();

jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    openCurrenciesQuery: async () => [...mockHeldCurrencies].map((currency) => ({ currency })),
  },
}));
jest.mock('@kiko/prices/daily-limit', () => ({ confirmDailyLimit: async () => {} }));
jest.mock('@kiko/prices/metal-refresh', () => ({ refreshMetalPrices: async () => {} }));
jest.mock('@kiko/prices/share-refresh', () => ({ refreshSharePrices: async () => 'ok' }));

import { settleJobsBesideMarketRefresh } from './settle-jobs-beside-market-refresh';

const MINUTE_MS = 60 * 1000;

const usdRate = { base: 'USD', quote: 'UAH', rate: 41, source: 'monobank' };
const bitcoinPrice = { base: 'BTC', quote: 'USD', rate: 60000, source: 'coingecko' };

const requests = (): { monobank: number; nbu: number; coingecko: number } => ({
  monobank: mockFetchFiat.mock.calls.length,
  nbu: mockFetchNbu.mock.calls.length,
  coingecko: mockFetchCrypto.mock.calls.length,
});

// The rates already stored, the last write `ageMinutes` ago.
const storeRates = (ageMinutes: number): void => {
  mockStoredRates.set('USD', Date.now() - ageMinutes * MINUTE_MS);
};

// A job that brings a currency in only once the refresh beside it has read the
// held set, so that refresh cannot have seen it.
const jobBringingIn = (currency: string): { name: string; run: () => Promise<void> } => {
  let gateRead!: () => void;
  const afterGateRead = new Promise<void>((resolve) => {
    gateRead = resolve;
  });

  mockOpenCurrencies.mockImplementation(async () => {
    const nonBaseCurrencies = [...mockHeldCurrencies].filter(
      (heldCurrency) => heldCurrency !== 'UAH',
    );
    const answer = {
      needsFiat: nonBaseCurrencies.length > 0,
      cryptoCurrencies: nonBaseCurrencies.filter((heldCurrency) => heldCurrency === 'BTC'),
      nonBaseCurrencies,
    };
    gateRead();

    return answer;
  });

  return {
    name: 'Binance',
    run: async () => {
      await afterGateRead;
      mockHeldCurrencies.add(currency);
    },
  };
};

const quietJob = { name: 'Mono', run: async () => {} };

describe('settleJobsBesideMarketRefresh — requests per run', () => {
  beforeEach(() => {
    mockStoredRates.clear();
    mockHeldCurrencies.clear();
    mockHeldCurrencies.add('UAH');
    mockHeldCurrencies.add('USD');
    mockFetchFiat.mockReset().mockResolvedValue([usdRate]);
    mockFetchNbu.mockReset().mockResolvedValue([usdRate]);
    mockFetchCrypto.mockReset().mockResolvedValue([bitcoinPrice]);
    mockOpenCurrencies.mockReset().mockImplementation(async () => ({
      needsFiat: true,
      cryptoCurrencies: [],
      nonBaseCurrencies: ['USD'],
    }));
    // The retry backoff waits seconds; the count is what is under test.
    jest.spyOn(global, 'setTimeout').mockImplementation(((callback: () => void) => {
      callback();

      return 0;
    }) as unknown as typeof setTimeout);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('makes no request when the rates are fresh and no currency is new', async () => {
    storeRates(1);

    await settleJobsBesideMarketRefresh([quietJob], '[test]');

    expect(requests()).toEqual({ monobank: 0, nbu: 0, coingecko: 0 });
  });

  it('makes one fiat request when the rates are stale and no currency is new', async () => {
    storeRates(10);

    await settleJobsBesideMarketRefresh([quietJob], '[test]');

    expect(requests()).toEqual({ monobank: 1, nbu: 0, coingecko: 0 });
  });

  it('prices a currency a job brought in during this run', async () => {
    storeRates(10);

    await settleJobsBesideMarketRefresh([jobBringingIn('BTC')], '[test]');

    expect(mockStoredRates.has('BTC')).toBe(true);
    expect(requests()).toEqual({ monobank: 2, nbu: 0, coingecko: 1 });
  });

  it('retries a failed fiat leg and tries the fallback once, and does not repeat them for the same run', async () => {
    storeRates(10);
    mockFetchFiat.mockRejectedValue(new Error('Monobank currency request failed: 503'));
    mockFetchNbu.mockRejectedValue(new Error('NBU request failed: 503'));

    await settleJobsBesideMarketRefresh([quietJob], '[test]');

    expect(requests()).toEqual({ monobank: 3, nbu: 1, coingecko: 0 });
  });

  it('falls back to NBU after a 429 and does not request Monobank again for the same run', async () => {
    storeRates(10);
    mockFetchFiat.mockRejectedValue(new Error('Monobank currency request failed: 429'));

    await settleJobsBesideMarketRefresh([quietJob], '[test]');

    expect(requests()).toEqual({ monobank: 3, nbu: 1, coingecko: 0 });
    expect(mockStoredRates.get('USD')).toBeGreaterThan(Date.now() - MINUTE_MS);
  });

  it('never rejects when a 429 hits the request made for a currency a job brought in', async () => {
    storeRates(10);
    mockFetchFiat
      .mockResolvedValueOnce([usdRate])
      .mockRejectedValue(new Error('Monobank currency request failed: 429'));

    const results = await settleJobsBesideMarketRefresh([jobBringingIn('BTC')], '[test]');

    expect(results).toEqual([{ status: 'fulfilled', value: undefined }]);
    expect(requests()).toEqual({ monobank: 4, nbu: 1, coingecko: 1 });
  });
});
