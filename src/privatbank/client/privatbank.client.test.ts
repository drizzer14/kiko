import type { PrivatbankAccount, PrivatbankStatementItem } from '../privatbank.types';

import {
  fetchAccounts,
  fetchStatement,
  PrivatbankRateLimitError,
  PrivatbankTimeoutError,
} from './privatbank.client';

const TOKEN = 'token-fixture';

const accountsFixture: PrivatbankAccount[] = [
  { acc: 'UA000000000000000000000000000', CCY: 'UAH', balance: '1234.56' },
];

const statementFixture: PrivatbankStatementItem[] = [
  {
    REF: 'ref-1',
    REFN: '1',
    SUM: '100.00',
    CCY: 'UAH',
    TRANTYPE: 'D',
    DATE_TIME_DAT_OD_TIM_P: '01.01.2026 10:00:00',
    OSND: 'Coffee',
  },
  {
    REF: 'ref-2',
    REFN: '1',
    SUM: '250.50',
    CCY: 'UAH',
    TRANTYPE: 'C',
    DATE_TIME_DAT_OD_TIM_P: '02.01.2026 11:30:00',
  },
];

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 500 })) as unknown as typeof fetch;

type SpyFetchInit = { headers: Record<string, string> };

describe('fetchAccounts', () => {
  it('hits /api/statements/balance with the token/User-Agent/utf8 headers and returns the balance page', async () => {
    let sentUrl = '';
    let sentHeaders: Record<string, string> = {};
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentHeaders = init.headers;
      return { ok: true, json: async () => ({ balances: accountsFixture }), status: 200 };
    }) as unknown as typeof fetch;

    const result = await fetchAccounts(TOKEN, spyFetch);

    expect(sentUrl).toContain('/api/statements/balance');
    expect(sentHeaders.token).toBe('token-fixture');
    expect(sentHeaders['User-Agent']).toBeTruthy();
    expect(sentHeaders['Content-Type']).toBe('application/json;charset=utf8');
    expect(result).toEqual({ balances: accountsFixture });
  });

  it('appends followId when paging the balance envelope', async () => {
    let sentUrl = '';
    const spyFetch = (async (url: string) => {
      sentUrl = url;
      return { ok: true, json: async () => ({ balances: [] }), status: 200 };
    }) as unknown as typeof fetch;

    await fetchAccounts(TOKEN, spyFetch, { followId: 'cursor-1' });

    expect(sentUrl).toContain('followId=cursor-1');
  });

  it('throws on a non-ok, non-429 response', async () => {
    await expect(fetchAccounts(TOKEN, makeFetch({}, false))).rejects.toThrow('500');
  });
});

describe('fetchStatement', () => {
  it('hits /api/statements/transactions with acc, DD-MM-YYYY startDate/endDate, and limit', async () => {
    let sentUrl = '';
    let sentHeaders: Record<string, string> = {};
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentHeaders = init.headers;
      return { ok: true, json: async () => ({ transactions: statementFixture }), status: 200 };
    }) as unknown as typeof fetch;

    const result = await fetchStatement(TOKEN, 'acc-1', 1_704_067_200, 1_704_240_000, spyFetch);

    expect(sentUrl).toContain('/api/statements/transactions');
    expect(sentUrl).toContain('acc=acc-1');
    expect(sentUrl).toContain('startDate=01-01-2024');
    expect(sentUrl).toContain('endDate=03-01-2024');
    expect(sentUrl).toContain('limit=100');
    expect(sentHeaders.token).toBe('token-fixture');
    expect(sentHeaders['Content-Type']).toBe('application/json;charset=utf8');
    expect(result).toEqual({ transactions: statementFixture });
  });

  it('passes followId as the pagination cursor when provided', async () => {
    let sentUrl = '';
    const spyFetch = (async (url: string) => {
      sentUrl = url;
      return { ok: true, json: async () => ({ transactions: [] }), status: 200 };
    }) as unknown as typeof fetch;

    await fetchStatement(TOKEN, 'acc-1', 1_704_067_200, 1_704_240_000, spyFetch, {
      followId: 'cursor-1',
    });

    expect(sentUrl).toContain('followId=cursor-1');
  });

  it('surfaces exist_next_page/next_page_id so the caller can keep following the cursor', async () => {
    const spyFetch = (async () => ({
      ok: true,
      json: async () => ({
        transactions: statementFixture,
        exist_next_page: true,
        next_page_id: 'cursor-2',
      }),
      status: 200,
    })) as unknown as typeof fetch;

    const result = await fetchStatement(TOKEN, 'acc-1', 1_704_067_200, 1_704_240_000, spyFetch);

    expect(result.exist_next_page).toBe(true);
    expect(result.next_page_id).toBe('cursor-2');
    expect(result.transactions).toEqual(statementFixture);
  });

  it('throws on a non-ok, non-429 response', async () => {
    await expect(
      fetchStatement(TOKEN, 'acc-1', 1_704_067_200, 1_704_240_000, makeFetch({}, false)),
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
            json: async () => ({ balances: accountsFixture }),
          } as unknown as Response);
    }) as unknown as typeof fetch;

    const result = await fetchAccounts(TOKEN, fetchImpl, { sleep });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(result).toEqual({ balances: accountsFixture });
  });

  it('falls back to the per-credential interval when the 429 carries no Retry-After header', async () => {
    const sleep = jest.fn(async () => undefined);
    let call = 0;
    const fetchImpl = jest.fn(async () => {
      call += 1;
      return call === 1
        ? rateLimited(null)
        : ({
            ok: true,
            status: 200,
            json: async () => ({ balances: accountsFixture }),
          } as unknown as Response);
    }) as unknown as typeof fetch;

    await fetchAccounts(TOKEN, fetchImpl, { sleep });

    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it('falls back to the per-credential interval when Retry-After is a non-positive 0', async () => {
    const sleep = jest.fn(async () => undefined);
    let call = 0;
    const fetchImpl = jest.fn(async () => {
      call += 1;
      return call === 1
        ? rateLimited('0')
        : ({
            ok: true,
            status: 200,
            json: async () => ({ balances: accountsFixture }),
          } as unknown as Response);
    }) as unknown as typeof fetch;

    await fetchAccounts(TOKEN, fetchImpl, { sleep });

    expect(sleep).toHaveBeenCalledWith(60_000);
    expect(sleep).not.toHaveBeenCalledWith(0);
  });

  it('gives up after the bounded retry count and surfaces a distinct rate-limited error', async () => {
    const sleep = jest.fn(async () => undefined);
    const fetchImpl = jest.fn(async () => rateLimited('1')) as unknown as typeof fetch;

    await expect(fetchAccounts(TOKEN, fetchImpl, { sleep, maxRetries: 2 })).rejects.toBeInstanceOf(
      PrivatbankRateLimitError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
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
      const assertion = expect(pending).rejects.toBeInstanceOf(PrivatbankTimeoutError);

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
      json: async () => ({ balances: accountsFixture }),
    })) as unknown as typeof fetch;

    const result = await fetchAccounts(TOKEN, fetchImpl);

    expect(result).toEqual({ balances: accountsFixture });
  });
});
