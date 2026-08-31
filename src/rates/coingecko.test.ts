import { fetchBTCPrice } from './coingecko';

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 429 })) as unknown as typeof fetch;

describe('fetchBTCPrice', () => {
  it('requests the CoinGecko simple-price endpoint', async () => {
    let sentUrl = '';
    const spyFetch = (async (url: string) => {
      sentUrl = url;
      return { ok: true, json: async () => ({ bitcoin: { usd: 65_000 } }), status: 200 };
    }) as unknown as typeof fetch;

    await fetchBTCPrice(spyFetch);

    expect(sentUrl).toBe(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    );
  });

  it('returns the BTC->USD rate entry', async () => {
    const result = await fetchBTCPrice(makeFetch({ bitcoin: { usd: 65_000 } }));

    expect(result).toEqual([{ base: 'BTC', quote: 'USD', rate: 65_000, source: 'coingecko' }]);
  });

  it('throws on a non-ok response', async () => {
    await expect(fetchBTCPrice(makeFetch({}, false))).rejects.toThrow('429');
  });
});
