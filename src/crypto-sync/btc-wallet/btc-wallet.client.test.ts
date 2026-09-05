import { fetchAddressBalance } from './btc-wallet.client';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const esploraBody = (fundedSatoshis: number, spentSatoshis: number) => ({
  address: ADDRESS,
  chain_stats: {
    funded_txo_count: 3,
    funded_txo_sum: fundedSatoshis,
    spent_txo_count: 1,
    spent_txo_sum: spentSatoshis,
    tx_count: 4,
  },
  mempool_stats: {
    funded_txo_count: 0,
    funded_txo_sum: 0,
    spent_txo_count: 0,
    spent_txo_sum: 0,
    tx_count: 0,
  },
});

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 400 })) as unknown as typeof fetch;

describe('fetchAddressBalance', () => {
  it('requests the Esplora address endpoint for the given address', async () => {
    let sentUrl = '';
    const spyFetch = (async (url: string) => {
      sentUrl = url;
      return { ok: true, json: async () => esploraBody(0, 0), status: 200 };
    }) as unknown as typeof fetch;

    await fetchAddressBalance(ADDRESS, spyFetch);

    expect(sentUrl).toBe(`https://blockstream.info/api/address/${ADDRESS}`);
  });

  it('returns funded minus spent satoshis from chain_stats', async () => {
    const result = await fetchAddressBalance(
      ADDRESS,
      makeFetch(esploraBody(150_000_000, 37_654_322)),
    );

    expect(result).toBe(112_345_678);
  });

  it('ignores mempool (unconfirmed) stats', async () => {
    const body = esploraBody(100, 40);
    body.mempool_stats.funded_txo_sum = 1_000_000;

    expect(await fetchAddressBalance(ADDRESS, makeFetch(body))).toBe(60);
  });

  it('throws with the status on a non-ok response', async () => {
    await expect(fetchAddressBalance(ADDRESS, makeFetch({}, false))).rejects.toThrow(
      'Block explorer request failed: 400',
    );
  });
});
