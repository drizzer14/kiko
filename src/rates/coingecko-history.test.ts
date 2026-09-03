import { fetchBTCHistory } from './coingecko-history';

const DAY_MS = 24 * 60 * 60 * 1000;

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 429 })) as unknown as typeof fetch;

describe('fetchBTCHistory', () => {
  const d1 = Date.UTC(2026, 8, 1);
  const d2 = Date.UTC(2026, 8, 2);
  const d3 = Date.UTC(2026, 8, 3);

  it('requests the market_chart endpoint for the given day span', async () => {
    let sentUrl = '';
    const spyFetch = (async (url: string) => {
      sentUrl = url;
      return { ok: true, status: 200, json: async () => ({ prices: [] }) };
    }) as unknown as typeof fetch;

    await fetchBTCHistory(30, spyFetch);

    expect(sentUrl).toBe(
      'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=30&interval=daily',
    );
  });

  it('parses daily [ts, price] points into day-normalized BTC->USD entries', async () => {
    const result = await fetchBTCHistory(
      3,
      makeFetch({
        prices: [
          [d1, 78_552],
          [d2, 77_416],
          [d3, 77_297],
        ],
      }),
    );

    expect(result).toEqual([
      { base: 'BTC', quote: 'USD', day: d1, rate: 78_552, source: 'coingecko' },
      { base: 'BTC', quote: 'USD', day: d2, rate: 77_416, source: 'coingecko' },
      { base: 'BTC', quote: 'USD', day: d3, rate: 77_297, source: 'coingecko' },
    ]);
  });

  it('collapses a trailing intraday point onto its day, keeping the latest price', async () => {
    const intraday = d3 + 13 * 60 * 60 * 1000;
    const result = await fetchBTCHistory(
      3,
      makeFetch({
        prices: [
          [d3, 77_297],
          [intraday, 77_730],
        ],
      }),
    );

    expect(result).toEqual([
      { base: 'BTC', quote: 'USD', day: d3, rate: 77_730, source: 'coingecko' },
    ]);
  });

  it('omits a point whose price is not a finite number', async () => {
    const result = await fetchBTCHistory(
      2,
      makeFetch({
        prices: [
          [d1, Number.NaN],
          [d2, 77_416],
        ],
      }),
    );

    expect(result).toEqual([
      { base: 'BTC', quote: 'USD', day: d2, rate: 77_416, source: 'coingecko' },
    ]);
  });

  it('throws on a non-ok response', async () => {
    await expect(fetchBTCHistory(30, makeFetch({}, false))).rejects.toThrow('429');
  });

  it('references DAY_MS-aligned days in its fixtures', () => {
    expect(d2 - d1).toBe(DAY_MS);
  });
});
