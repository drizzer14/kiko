import { fetchCryptoPrices } from './coingecko';

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 429 })) as unknown as typeof fetch;

const body = { bitcoin: { usd: 65_000 }, ethereum: { usd: 3_200 }, tether: { usd: 1.0007 } };

describe('fetchCryptoPrices', () => {
  it('requests the simple-price endpoint for every crypto id', async () => {
    let sentUrl = '';
    const spyFetch = (async (url: string) => {
      sentUrl = url;
      return { ok: true, json: async () => body, status: 200 };
    }) as unknown as typeof fetch;

    await fetchCryptoPrices(spyFetch);

    expect(sentUrl).toBe(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=usd',
    );
  });

  it('returns one <crypto>->USD entry per coin', async () => {
    const result = await fetchCryptoPrices(makeFetch(body));

    expect(result).toEqual([
      { base: 'BTC', quote: 'USD', rate: 65_000, source: 'coingecko' },
      { base: 'ETH', quote: 'USD', rate: 3_200, source: 'coingecko' },
      { base: 'USDT', quote: 'USD', rate: 1.0007, source: 'coingecko' },
    ]);
  });

  it('throws on a non-ok response', async () => {
    await expect(fetchCryptoPrices(makeFetch({}, false))).rejects.toThrow('429');
  });

  it('rejects when any requested coin is missing a finite usd price', async () => {
    await expect(fetchCryptoPrices(makeFetch({ bitcoin: { usd: 65_000 } }))).rejects.toThrow(
      /CoinGecko/,
    );
    await expect(
      fetchCryptoPrices(
        makeFetch({ bitcoin: { usd: 65_000 }, ethereum: { usd: 3_200 }, tether: { usd: 'lots' } }),
      ),
    ).rejects.toThrow(/CoinGecko/);
  });
});
