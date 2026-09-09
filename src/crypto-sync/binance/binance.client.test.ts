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

// The base `timestamp=…&recvWindow=…` signing is pinned to EXPECTED_SIGNATURE by
// the fetchAccount tests above; the SAPI reads add an `asset=BTC` filter (and the
// position reads add pagination params), so these assert the param set and that a
// signature is present rather than re-deriving the HMAC.
type SpyInit = { method?: string; headers: Record<string, string> };

describe('fetchFundingAsset', () => {
  it('POSTs to /sapi/v1/asset/get-funding-asset filtered to BTC, signed, with the api-key header', async () => {
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

    const url = new URL(sentUrl);
    expect(url.pathname).toBe('/sapi/v1/asset/get-funding-asset');
    expect(url.searchParams.get('asset')).toBe('BTC');
    expect(url.searchParams.get('recvWindow')).toBe('5000');
    expect(url.searchParams.get('timestamp')).toBe(String(NOW));
    expect(url.searchParams.get('signature')).toBeTruthy();
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

// A fetch that answers each `current` page from the given map. A page absent from
// the map answers an empty final page, so a test lists only the pages it cares
// about. Records every requested URL so a test can assert the walked pages.
const pagedFetch = (
  pagesByCurrent: Record<string, { rows: unknown[]; total: number }>,
  calls: string[],
): typeof fetch =>
  (async (url: string) => {
    calls.push(url);
    const current = new URL(url).searchParams.get('current') ?? '1';
    const page = pagesByCurrent[current] ?? { rows: [], total: 0 };
    return { ok: true, status: 200, json: async () => page };
  }) as unknown as typeof fetch;

// One BTC flexible row of a fixed amount, for building multi-page fixtures.
const flexRow = { asset: 'BTC', totalAmount: '0.01' };

describe('fetchFlexiblePosition', () => {
  it('GETs the first page filtered to BTC, size 100, current 1, signed, with the api-key header', async () => {
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

    const url = new URL(sentUrl);
    expect(url.pathname).toBe('/sapi/v1/simple-earn/flexible/position');
    expect(url.searchParams.get('asset')).toBe('BTC');
    expect(url.searchParams.get('current')).toBe('1');
    expect(url.searchParams.get('size')).toBe('100');
    expect(url.searchParams.get('recvWindow')).toBe('5000');
    expect(url.searchParams.get('timestamp')).toBe(String(NOW));
    expect(url.searchParams.get('signature')).toBeTruthy();
    expect(sentInit.method).toBe('GET');
    expect(sentInit.headers['X-MBX-APIKEY']).toBe('api-key-fixture');
  });

  it('stops after one page when the first page is shorter than the page size', async () => {
    const calls: string[] = [];
    const fetchImpl = pagedFetch(
      { '1': { rows: [{ asset: 'BTC', totalAmount: '0.5' }], total: 1 } },
      calls,
    );

    const result = await fetchFlexiblePosition('api-key-fixture', 'secret-fixture', {
      fetchImpl,
      now: () => NOW,
    });

    expect(result).toEqual({ rows: [{ asset: 'BTC', totalAmount: '0.5' }], total: 1 });
    expect(calls).toHaveLength(1);
  });

  it('walks `current` until the gathered rows cover `total`, accumulating every page', async () => {
    const calls: string[] = [];
    // total 150 across two pages: a full 100-row page, then a 50-row page.
    const fetchImpl = pagedFetch(
      {
        '1': { rows: Array.from({ length: 100 }, () => flexRow), total: 150 },
        '2': { rows: Array.from({ length: 50 }, () => flexRow), total: 150 },
      },
      calls,
    );

    const result = await fetchFlexiblePosition('api-key-fixture', 'secret-fixture', {
      fetchImpl,
      now: () => NOW,
    });

    expect(result.rows).toHaveLength(150);
    expect(result.total).toBe(150);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0]).searchParams.get('current')).toBe('1');
    expect(new URL(calls[1]).searchParams.get('current')).toBe('2');
  });

  it('rejects if a later page fails, so the caller skips the whole wallet (no partial total)', async () => {
    const spyFetch = (async (url: string) => {
      const current = new URL(url).searchParams.get('current');
      if (current === '1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ rows: Array.from({ length: 100 }, () => flexRow), total: 150 }),
        };
      }
      return {
        ok: false,
        status: 429,
        json: async () => ({ code: -1003, msg: 'Too much request weight used' }),
      };
    }) as unknown as typeof fetch;

    await expect(
      fetchFlexiblePosition('api-key-fixture', 'secret-fixture', {
        fetchImpl: spyFetch,
        now: () => NOW,
      }),
    ).rejects.toThrow('Too much request weight used');
  });
});

describe('fetchLockedPosition', () => {
  it('GETs the first page of /simple-earn/locked/position filtered to BTC, size 100, current 1', async () => {
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

    const url = new URL(sentUrl);
    expect(url.pathname).toBe('/sapi/v1/simple-earn/locked/position');
    expect(url.searchParams.get('asset')).toBe('BTC');
    expect(url.searchParams.get('current')).toBe('1');
    expect(url.searchParams.get('size')).toBe('100');
    expect(url.searchParams.get('signature')).toBeTruthy();
    expect(sentInit.method).toBe('GET');
    expect(sentInit.headers['X-MBX-APIKEY']).toBe('api-key-fixture');
  });

  it('walks `current` until the gathered rows cover `total`, accumulating every page', async () => {
    const calls: string[] = [];
    const lockedRow = { asset: 'BTC', amount: '0.02' };
    const fetchImpl = pagedFetch(
      {
        '1': { rows: Array.from({ length: 100 }, () => lockedRow), total: 130 },
        '2': { rows: Array.from({ length: 30 }, () => lockedRow), total: 130 },
      },
      calls,
    );

    const result = await fetchLockedPosition('api-key-fixture', 'secret-fixture', {
      fetchImpl,
      now: () => NOW,
    });

    expect(result.rows).toHaveLength(130);
    expect(result.total).toBe(130);
    expect(calls).toHaveLength(2);
  });
});
