import {
  fetchAccount,
  fetchFlexiblePosition,
  fetchFundingAsset,
  fetchLockedPosition,
} from './binance.client';

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

// Every signed endpoint reuses the SAME `timestamp=…&recvWindow=…` query, so the
// signature is identical to the fetchAccount fixture above (see binance.hmac.test.ts).
type SpyInit = { method?: string; headers: Record<string, string> };

describe('fetchFundingAsset', () => {
  it('POSTs a signed query to /sapi/v1/asset/get-funding-asset with the api-key header', async () => {
    let sentUrl = '';
    let sentInit: SpyInit = { headers: {} };
    const spyFetch = (async (url: string, init: SpyInit) => {
      sentUrl = url;
      sentInit = init;
      return { ok: true, json: async () => [], status: 200 };
    }) as unknown as typeof fetch;

    await fetchFundingAsset('api-key-fixture', 'secret-fixture', {
      fetchImpl: spyFetch,
      now: () => NOW,
    });

    expect(sentUrl).toBe(
      `https://api.binance.com/sapi/v1/asset/get-funding-asset?timestamp=${NOW}&recvWindow=5000&signature=${EXPECTED_SIGNATURE}`,
    );
    expect(sentInit.method).toBe('POST');
    expect(sentInit.headers['X-MBX-APIKEY']).toBe('api-key-fixture');
  });

  it('returns the parsed funding-asset array', async () => {
    const body = [{ asset: 'BTC', free: '0.1', locked: '0.2', freeze: '0.3', withdrawing: '0.4' }];

    const result = await fetchFundingAsset('api-key-fixture', 'secret-fixture', {
      fetchImpl: makeFetch(body),
      now: () => NOW,
    });

    expect(result).toEqual(body);
  });

  it('rejects on a non-ok response so the provider can skip only this wallet', async () => {
    const invalidBody = { code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' };

    await expect(
      fetchFundingAsset('api-key-fixture', 'secret-fixture', {
        fetchImpl: makeFetch(invalidBody, false, 401),
      }),
    ).rejects.toThrow('Invalid API-key, IP, or permissions for action.');
  });
});

describe('fetchFlexiblePosition', () => {
  it('GETs a signed query to /sapi/v1/simple-earn/flexible/position with the api-key header', async () => {
    let sentUrl = '';
    let sentInit: SpyInit = { headers: {} };
    const spyFetch = (async (url: string, init: SpyInit) => {
      sentUrl = url;
      sentInit = init;
      return { ok: true, json: async () => ({ rows: [], total: 0 }), status: 200 };
    }) as unknown as typeof fetch;

    await fetchFlexiblePosition('api-key-fixture', 'secret-fixture', {
      fetchImpl: spyFetch,
      now: () => NOW,
    });

    expect(sentUrl).toBe(
      `https://api.binance.com/sapi/v1/simple-earn/flexible/position?timestamp=${NOW}&recvWindow=5000&signature=${EXPECTED_SIGNATURE}`,
    );
    expect(sentInit.method).toBe('GET');
    expect(sentInit.headers['X-MBX-APIKEY']).toBe('api-key-fixture');
  });

  it('returns the parsed rows body (flexible positions carry totalAmount)', async () => {
    const body = { rows: [{ asset: 'BTC', totalAmount: '0.5' }], total: 1 };

    const result = await fetchFlexiblePosition('api-key-fixture', 'secret-fixture', {
      fetchImpl: makeFetch(body),
      now: () => NOW,
    });

    expect(result).toEqual(body);
  });
});

describe('fetchLockedPosition', () => {
  it('GETs a signed query to /sapi/v1/simple-earn/locked/position with the api-key header', async () => {
    let sentUrl = '';
    let sentInit: SpyInit = { headers: {} };
    const spyFetch = (async (url: string, init: SpyInit) => {
      sentUrl = url;
      sentInit = init;
      return { ok: true, json: async () => ({ rows: [], total: 0 }), status: 200 };
    }) as unknown as typeof fetch;

    await fetchLockedPosition('api-key-fixture', 'secret-fixture', {
      fetchImpl: spyFetch,
      now: () => NOW,
    });

    expect(sentUrl).toBe(
      `https://api.binance.com/sapi/v1/simple-earn/locked/position?timestamp=${NOW}&recvWindow=5000&signature=${EXPECTED_SIGNATURE}`,
    );
    expect(sentInit.method).toBe('GET');
    expect(sentInit.headers['X-MBX-APIKEY']).toBe('api-key-fixture');
  });

  it('returns the parsed rows body (locked positions carry amount)', async () => {
    const body = { rows: [{ asset: 'BTC', amount: '0.25' }], total: 1 };

    const result = await fetchLockedPosition('api-key-fixture', 'secret-fixture', {
      fetchImpl: makeFetch(body),
      now: () => NOW,
    });

    expect(result).toEqual(body);
  });
});
