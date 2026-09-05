import { fetchAccount } from './binance.client';

const NOW = 1_704_326_400_000;
// signQuery('secret-fixture', 'timestamp=1704326400000&recvWindow=5000') — see binance.hmac.test.ts.
const EXPECTED_SIGNATURE = 'c548b5a5c27c61b57b685766340cfe11dff7cb5d0a693484f3af3e13f129df7f';

const accountBody = {
  makerCommission: 10,
  canTrade: false,
  balances: [
    { asset: 'BTC', free: '0.50000000', locked: '0.25000000' },
    { asset: 'ETH', free: '2.00000000', locked: '0.00000000' },
  ],
};

type SpyFetchInit = { headers: Record<string, string> };

const makeFetch = (body: unknown, ok = true, status = ok ? 200 : 401): typeof fetch =>
  (async () => ({ ok, json: async () => body, status })) as unknown as typeof fetch;

describe('fetchAccount', () => {
  it('sends the X-MBX-APIKEY header and a signed timestamp/recvWindow query to /api/v3/account', async () => {
    let sentUrl = '';
    let sentHeaders: Record<string, string> = {};
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentHeaders = init.headers;
      return { ok: true, json: async () => accountBody, status: 200 };
    }) as unknown as typeof fetch;

    await fetchAccount('api-key-fixture', 'secret-fixture', {
      fetchImpl: spyFetch,
      now: () => NOW,
    });

    expect(sentUrl).toBe(
      `https://api.binance.com/api/v3/account?timestamp=${NOW}&recvWindow=5000&signature=${EXPECTED_SIGNATURE}`,
    );
    expect(sentHeaders['X-MBX-APIKEY']).toBe('api-key-fixture');
  });

  it('returns the parsed balances', async () => {
    const result = await fetchAccount('api-key-fixture', 'secret-fixture', {
      fetchImpl: makeFetch(accountBody),
      now: () => NOW,
    });

    expect(result.balances).toHaveLength(2);
    expect(result.balances[0]).toEqual({ asset: 'BTC', free: '0.50000000', locked: '0.25000000' });
  });

  it('throws with the status on a non-ok response without a Binance error body', async () => {
    await expect(
      fetchAccount('api-key-fixture', 'secret-fixture', { fetchImpl: makeFetch({}, false, 401) }),
    ).rejects.toThrow('Binance request failed: 401');
  });

  it("surfaces Binance's own message on a clock-skew rejection instead of swallowing it", async () => {
    const skewBody = {
      code: -1021,
      msg: 'Timestamp for this request is outside of the recvWindow.',
    };

    await expect(
      fetchAccount('api-key-fixture', 'secret-fixture', {
        fetchImpl: makeFetch(skewBody, false, 400),
        // a stale clock: the request timestamp lags real time by well over recvWindow
        now: () => NOW - 60_000,
      }),
    ).rejects.toThrow(
      'Binance request failed: 400: Timestamp for this request is outside of the recvWindow.',
    );
  });

  it("surfaces Binance's invalid-key message", async () => {
    const invalidBody = { code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' };

    await expect(
      fetchAccount('api-key-fixture', 'secret-fixture', {
        fetchImpl: makeFetch(invalidBody, false, 401),
      }),
    ).rejects.toThrow('Invalid API-key, IP, or permissions for action.');
  });

  it('still throws with the status when the error body is not JSON', async () => {
    const htmlFetch = (async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    })) as unknown as typeof fetch;

    await expect(
      fetchAccount('api-key-fixture', 'secret-fixture', { fetchImpl: htmlFetch }),
    ).rejects.toThrow('Binance request failed: 502');
  });
});
