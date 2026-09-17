import type { StarlingAccount, StarlingBalance, StarlingFeedItem } from '../starling.types';

import {
  fetchAccounts,
  fetchBalance,
  fetchFeedChangedSince,
  StarlingRateLimitError,
  StarlingTimeoutError,
} from './starling.client';

const TOKEN = 'pat-fixture';

const accountFixture: StarlingAccount = {
  accountUid: 'acc-uid-1',
  defaultCategory: 'category-uid-1',
  currency: 'GBP',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const balanceFixture: StarlingBalance = {
  clearedBalance: { currency: 'GBP', minorUnits: 123_456 },
  effectiveBalance: { currency: 'GBP', minorUnits: 100_000 },
  availableToSpend: { currency: 'GBP', minorUnits: 100_000 },
};

const feedItemFixture: StarlingFeedItem = {
  feedItemUid: 'feed-1',
  categoryUid: 'category-uid-1',
  amount: { currency: 'GBP', minorUnits: 500 },
  direction: 'OUT',
  transactionTime: '2026-01-02T10:00:00.000Z',
  status: 'SETTLED',
  counterPartyName: 'Coffee shop',
  reference: 'Coffee',
};

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 500 })) as unknown as typeof fetch;

type SpyFetchInit = { headers: Record<string, string> };

describe('fetchAccounts', () => {
  it('sends the bearer token and returns the unwrapped account list', async () => {
    let sentUrl = '';
    let sentHeaders: Record<string, string> = {};
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentHeaders = init.headers;
      return { ok: true, json: async () => ({ accounts: [accountFixture] }), status: 200 };
    }) as unknown as typeof fetch;

    const result = await fetchAccounts(TOKEN, spyFetch);

    expect(sentUrl).toContain('/api/v2/accounts');
    expect(sentHeaders.Authorization).toBe('Bearer pat-fixture');
    expect(result).toEqual([accountFixture]);
  });

  it('throws on a non-ok, non-429 response', async () => {
    await expect(fetchAccounts(TOKEN, makeFetch({}, false))).rejects.toThrow('500');
  });
});

describe('fetchBalance', () => {
  it('sends the bearer token and returns the typed balance', async () => {
    let sentUrl = '';
    let sentHeaders: Record<string, string> = {};
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentHeaders = init.headers;
      return { ok: true, json: async () => balanceFixture, status: 200 };
    }) as unknown as typeof fetch;

    const result = await fetchBalance(TOKEN, 'acc-uid-1', spyFetch);

    expect(sentUrl).toContain('/api/v2/accounts/acc-uid-1/balance');
    expect(sentHeaders.Authorization).toBe('Bearer pat-fixture');
    expect(result).toEqual(balanceFixture);
  });

  it('throws on a non-ok, non-429 response', async () => {
    await expect(fetchBalance(TOKEN, 'acc-uid-1', makeFetch({}, false))).rejects.toThrow('500');
  });
});

describe('fetchFeedChangedSince', () => {
  it('sends the bearer token, the changesSince query param, and returns the unwrapped feed items', async () => {
    let sentUrl = '';
    let sentHeaders: Record<string, string> = {};
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentHeaders = init.headers;
      return { ok: true, json: async () => ({ feedItems: [feedItemFixture] }), status: 200 };
    }) as unknown as typeof fetch;

    const result = await fetchFeedChangedSince(
      TOKEN,
      'acc-uid-1',
      'category-uid-1',
      '2026-01-01T00:00:00.000Z',
      spyFetch,
    );

    expect(sentUrl).toContain('/api/v2/feed/account/acc-uid-1/category/category-uid-1');
    expect(sentUrl).toContain('changesSince=2026-01-01T00%3A00%3A00.000Z');
    expect(sentHeaders.Authorization).toBe('Bearer pat-fixture');
    expect(result).toEqual([feedItemFixture]);
  });

  it('throws on a non-ok, non-429 response', async () => {
    await expect(
      fetchFeedChangedSince(
        TOKEN,
        'acc-uid-1',
        'category-uid-1',
        '2026-01-01T00:00:00.000Z',
        makeFetch({}, false),
      ),
    ).rejects.toThrow('500');
  });
});

// A 429 header carrying seconds; a hit-then-clear counter drives a single retry.
const rateLimited = (retryAfter: string | null) =>
  ({
    ok: false,
    status: 429,
    headers: { get: (name: string) => (name === 'Retry-After' ? retryAfter : null) },
    json: async () => ({}),
  }) as unknown as Response;

describe('429 / Retry-After handling', () => {
  it('backs off for the Retry-After interval, retries, and returns the body on success', async () => {
    const sleep = jest.fn(async () => undefined);
    let call = 0;
    const fetchImpl = jest.fn(async () => {
      call += 1;
      return call === 1
        ? rateLimited('2')
        : ({
            ok: true,
            status: 200,
            json: async () => ({ accounts: [accountFixture] }),
          } as unknown as Response);
    }) as unknown as typeof fetch;

    const result = await fetchAccounts(TOKEN, fetchImpl, { sleep });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(result).toEqual([accountFixture]);
  });

  it('falls back to the per-token interval when the 429 carries no Retry-After header', async () => {
    const sleep = jest.fn(async () => undefined);
    let call = 0;
    const fetchImpl = jest.fn(async () => {
      call += 1;
      return call === 1
        ? rateLimited(null)
        : ({
            ok: true,
            status: 200,
            json: async () => ({ accounts: [accountFixture] }),
          } as unknown as Response);
    }) as unknown as typeof fetch;

    await fetchAccounts(TOKEN, fetchImpl, { sleep });

    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it('gives up after the bounded retry count and surfaces a distinct rate-limited error', async () => {
    const sleep = jest.fn(async () => undefined);
    const fetchImpl = jest.fn(async () => rateLimited('1')) as unknown as typeof fetch;

    await expect(fetchAccounts(TOKEN, fetchImpl, { sleep, maxRetries: 2 })).rejects.toBeInstanceOf(
      StarlingRateLimitError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('honors Retry-After on the feed endpoint too', async () => {
    const sleep = jest.fn(async () => undefined);
    let call = 0;
    const fetchImpl = jest.fn(async () => {
      call += 1;
      return call === 1
        ? rateLimited('3')
        : ({
            ok: true,
            status: 200,
            json: async () => ({ feedItems: [feedItemFixture] }),
          } as unknown as Response);
    }) as unknown as typeof fetch;

    await fetchFeedChangedSince(
      TOKEN,
      'acc-uid-1',
      'category-uid-1',
      '2026-01-01T00:00:00.000Z',
      fetchImpl,
      { sleep },
    );

    expect(sleep).toHaveBeenCalledWith(3000);
  });
});

describe('request timeout', () => {
  it('aborts a hung request after the timeout and surfaces a timeout error', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = ((_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          });
        })) as unknown as typeof fetch;

      const pending = fetchAccounts(TOKEN, fetchImpl, { timeoutMs: 30_000 });
      const assertion = expect(pending).rejects.toBeInstanceOf(StarlingTimeoutError);

      await jest.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears the timeout and returns normally when the response arrives in time', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ accounts: [accountFixture] }),
    })) as unknown as typeof fetch;

    const result = await fetchAccounts(TOKEN, fetchImpl);

    expect(result).toEqual([accountFixture]);
  });
});
