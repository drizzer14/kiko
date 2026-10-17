import { DAY_MS } from '@kiko/dates';

import {
  CoinGeckoRequestError,
  CryptoHistoryFailure,
  CRYPTO_HISTORY_CONCURRENCY,
  fetchCryptoHistory,
} from './coingecko-history';

describe('CoinGeckoRequestError', () => {
  it('names itself and carries the status of the answer', () => {
    const error = new CoinGeckoRequestError(429);

    expect(error.name).toBe('CoinGeckoRequestError');
    expect(error.message).toBe('CoinGecko request failed: 429');
    expect(error.status).toBe(429);
    expect(error).toBeInstanceOf(CoinGeckoRequestError);
  });
});

describe('CryptoHistoryFailure', () => {
  it('names itself and carries the rate-limited coins', () => {
    const failure = new CryptoHistoryFailure(['ETH']);

    expect(failure.name).toBe('CryptoHistoryFailure');
    expect(failure.message).toBe('CoinGecko history request failed for every coin');
    expect(failure.rateLimitedCurrencies).toEqual(['ETH']);
    expect(failure).toBeInstanceOf(CryptoHistoryFailure);
  });
});

const d1 = Date.UTC(2026, 8, 1);
const d2 = Date.UTC(2026, 8, 2);

// Route each coin id to its own price series; a coin's non-ok response is modeled
// per url so the "one coin fails, others survive" case can be exercised.
const makeRoutedFetch = (
  byCoin: Record<string, { ok?: boolean; status?: number; prices: [number, number][] }>,
): typeof fetch =>
  (async (url: string) => {
    const id = /coins\/([a-z]+)\/market_chart/.exec(url)?.[1] ?? '';
    const entry = byCoin[id] ?? { prices: [] };
    const ok = entry.ok ?? true;

    return {
      ok,
      status: ok ? 200 : (entry.status ?? 429),
      json: async () => ({ prices: entry.prices }),
    };
  }) as unknown as typeof fetch;

describe('fetchCryptoHistory', () => {
  it('requests each crypto coin’s market_chart for the day span and unions the series', async () => {
    const { entries: result } = await fetchCryptoHistory(
      2,
      makeRoutedFetch({
        bitcoin: {
          prices: [
            [d1, 78_552],
            [d2, 77_416],
          ],
        },
        ethereum: {
          prices: [
            [d1, 3_100],
            [d2, 3_200],
          ],
        },
        tether: {
          prices: [
            [d1, 1.0],
            [d2, 1.0007],
          ],
        },
      }),
    );

    expect(result).toContainEqual({
      base: 'BTC',
      quote: 'USD',
      day: d2,
      rate: 77_416,
      source: 'coingecko',
    });
    expect(result).toContainEqual({
      base: 'ETH',
      quote: 'USD',
      day: d1,
      rate: 3_100,
      source: 'coingecko',
    });
    expect(result).toContainEqual({
      base: 'USDT',
      quote: 'USD',
      day: d2,
      rate: 1.0007,
      source: 'coingecko',
    });
  });

  it('keeps the surviving coins when one coin request is non-ok', async () => {
    const { entries: result } = await fetchCryptoHistory(
      1,
      makeRoutedFetch({
        bitcoin: { prices: [[d1, 78_552]] },
        ethereum: { ok: false, prices: [] },
        tether: { prices: [[d1, 1.0]] },
      }),
    );

    expect(result.some((entry) => entry.base === 'BTC')).toBe(true);
    expect(result.some((entry) => entry.base === 'USDT')).toBe(true);
    expect(result.some((entry) => entry.base === 'ETH')).toBe(false);
  });

  // A coin whose OWN request failed is reported apart from one CoinGecko
  // answered empty, so the backfill never remembers a failure as "no data".
  it('reports which coins failed, never an empty-answered coin among them', async () => {
    const { failedCurrencies } = await fetchCryptoHistory(
      1,
      makeRoutedFetch({
        bitcoin: { prices: [[d1, 78_552]] },
        ethereum: { ok: false, prices: [] },
        tether: { prices: [] },
      }),
    );

    expect(failedCurrencies).toEqual(['ETH']);
  });

  // The burst limit is what a later run must route around; a coin that fails for any other
  // reason (a renamed id answering 404) is listed apart from it.
  it('lists a coin answered with 429 apart from one that failed for another reason', async () => {
    const result = await fetchCryptoHistory(
      1,
      makeRoutedFetch({
        bitcoin: { prices: [[d1, 78_552]] },
        ethereum: { ok: false, status: 429, prices: [] },
        solana: { ok: false, status: 404, prices: [] },
      }),
      ['BTC', 'ETH', 'SOL'],
    );

    expect(result.failedCurrencies).toEqual(['ETH', 'SOL']);
    expect(result.rateLimitedCurrencies).toEqual(['ETH']);
  });

  it('throws only when every coin request fails', async () => {
    await expect(
      fetchCryptoHistory(
        1,
        makeRoutedFetch({
          bitcoin: { ok: false, prices: [] },
          ethereum: { ok: false, prices: [] },
          tether: { ok: false, prices: [] },
        }),
        ['BTC', 'ETH', 'USDT'],
      ),
    ).rejects.toThrow(/CoinGecko/);
  });

  it('references DAY_MS-aligned days in its fixtures', () => {
    expect(d2 - d1).toBe(DAY_MS);
  });

  describe('a concurrency cap', () => {
    const SIX_COINS = ['BTC', 'ETH', 'USDT', 'BNB', 'XRP', 'SOL'] as const;

    it('never has more than the cap of coin requests in flight', async () => {
      let inFlight = 0;
      let mostInFlight = 0;
      const fetchImpl = (async () => {
        inFlight += 1;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;

        return { ok: true, status: 200, json: async () => ({ prices: [[d1, 1]] }) };
      }) as unknown as typeof fetch;

      await fetchCryptoHistory(1, fetchImpl, SIX_COINS);

      expect(mostInFlight).toBe(CRYPTO_HISTORY_CONCURRENCY);
    });

    it('still fetches every coin under the cap', async () => {
      const { entries, failedCurrencies } = await fetchCryptoHistory(
        1,
        makeRoutedFetch({
          bitcoin: { prices: [[d1, 78_552]] },
          ethereum: { prices: [[d1, 3_100]] },
          tether: { prices: [[d1, 1.0]] },
          binancecoin: { ok: false, prices: [] },
          ripple: { prices: [[d1, 2]] },
          solana: { prices: [[d1, 150]] },
        }),
        SIX_COINS,
      );

      expect(failedCurrencies).toEqual(['BNB']);
      expect(entries.map((entry) => entry.base)).toEqual(['BTC', 'ETH', 'USDT', 'XRP', 'SOL']);
    });
  });

  // kiko-architecture: no request for data the user does not have — a caller
  // that holds only a subset of the supported crypto currencies fetches only
  // that subset's history, never a market_chart call for a coin nobody holds.
  describe('a scoped currency list', () => {
    it('requests market_chart for only the given currencies', async () => {
      const requestedIds: string[] = [];
      const fetchImpl = (async (url: string) => {
        requestedIds.push(/coins\/([a-z]+)\/market_chart/.exec(url)?.[1] ?? '');

        return { ok: true, status: 200, json: async () => ({ prices: [[d1, 78_552]] }) };
      }) as unknown as typeof fetch;

      await fetchCryptoHistory(1, fetchImpl, ['BTC']);

      expect(requestedIds).toEqual(['bitcoin']);
    });

    it('makes no request at all for an empty currency list', async () => {
      let called = false;
      const fetchImpl = (async () => {
        called = true;

        return { ok: true, status: 200, json: async () => ({ prices: [] }) };
      }) as unknown as typeof fetch;

      await expect(fetchCryptoHistory(1, fetchImpl, [])).resolves.toEqual({
        entries: [],
        failedCurrencies: [],
        rateLimitedCurrencies: [],
      });
      expect(called).toBe(false);
    });
  });
});
