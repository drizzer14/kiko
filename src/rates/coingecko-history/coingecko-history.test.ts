import { fetchCryptoHistory } from './coingecko-history';

const DAY_MS = 24 * 60 * 60 * 1000;
const d1 = Date.UTC(2026, 8, 1);
const d2 = Date.UTC(2026, 8, 2);

// Route each coin id to its own price series; a coin's non-ok response is modeled
// per url so the "one coin fails, others survive" case can be exercised.
const makeRoutedFetch = (
  byCoin: Record<string, { ok?: boolean; prices: [number, number][] }>,
): typeof fetch =>
  (async (url: string) => {
    const id = /coins\/([a-z]+)\/market_chart/.exec(url)?.[1] ?? '';
    const entry = byCoin[id] ?? { prices: [] };
    const ok = entry.ok ?? true;
    return { ok, status: ok ? 200 : 429, json: async () => ({ prices: entry.prices }) };
  }) as unknown as typeof fetch;

describe('fetchCryptoHistory', () => {
  it('requests each crypto coin’s market_chart for the day span and unions the series', async () => {
    const result = await fetchCryptoHistory(
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
    const result = await fetchCryptoHistory(
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

  it('throws only when every coin request fails', async () => {
    await expect(
      fetchCryptoHistory(
        1,
        makeRoutedFetch({
          bitcoin: { ok: false, prices: [] },
          ethereum: { ok: false, prices: [] },
          tether: { ok: false, prices: [] },
        }),
      ),
    ).rejects.toThrow(/CoinGecko/);
  });

  it('references DAY_MS-aligned days in its fixtures', () => {
    expect(d2 - d1).toBe(DAY_MS);
  });
});
