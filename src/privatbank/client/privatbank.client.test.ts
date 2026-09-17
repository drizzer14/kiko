import type { PrivatbankAccount, PrivatbankStatementItem } from '../privatbank.types';

import {
  fetchAccounts,
  fetchStatement,
  PrivatbankRateLimitError,
  PrivatbankTimeoutError,
} from './privatbank.client';

const CREDENTIALS = { token: 'token-fixture', clientId: 'client-id-fixture' };

const accountsFixture: PrivatbankAccount[] = [
  { acc: 'UA000000000000000000000000000', currency: 'UAH', balance: '1234.56', name: 'Картка' },
];

const statementFixture: PrivatbankStatementItem[] = [
  { id: 'stmt-1', date: '01.01.2026 10:00:00', amount: '-100.00', currency: 'UAH' },
  { id: 'stmt-2', date: '02.01.2026 11:30:00', amount: '250.50', currency: 'UAH' },
];

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 500 })) as unknown as typeof fetch;

type SpyFetchInit = { headers: Record<string, string> };

describe('fetchAccounts', () => {
  it('sends the credential headers and returns the parsed account list', async () => {
    let sentUrl = '';
    let sentHeaders: Record<string, string> = {};
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentHeaders = init.headers;
      return { ok: true, json: async () => accountsFixture, status: 200 };
    }) as unknown as typeof fetch;

    const result = await fetchAccounts(CREDENTIALS, spyFetch);

    expect(sentUrl).toContain('/rest/accounts');
    expect(sentHeaders.token).toBe('token-fixture');
    expect(sentHeaders.id).toBe('client-id-fixture');
    expect(result).toEqual(accountsFixture);
  });

  it('throws on a non-ok, non-429 response', async () => {
    await expect(fetchAccounts(CREDENTIALS, makeFetch({}, false))).rejects.toThrow('500');
  });
});

describe('fetchStatement', () => {
  it('sends the credential headers and returns the typed statement items', async () => {
    let sentUrl = '';
    let sentHeaders: Record<string, string> = {};
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentHeaders = init.headers;
      return { ok: true, json: async () => statementFixture, status: 200 };
    }) as unknown as typeof fetch;

    const result = await fetchStatement(CREDENTIALS, 'acc-1', 1704067200, 1704240000, spyFetch);

    expect(sentUrl).toContain('/rest/statement');
    expect(sentUrl).toContain('acc-1');
    expect(sentHeaders.token).toBe('token-fixture');
    expect(sentHeaders.id).toBe('client-id-fixture');
    expect(result).toEqual(statementFixture);
  });

  it('throws on a non-ok, non-429 response', async () => {
    await expect(
      fetchStatement(CREDENTIALS, 'acc-1', 1704067200, 1704240000, makeFetch({}, false)),
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
        : ({ ok: true, status: 200, json: async () => accountsFixture } as unknown as Response);
    }) as unknown as typeof fetch;

    const result = await fetchAccounts(CREDENTIALS, fetchImpl, { sleep });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(result).toEqual(accountsFixture);
  });

  it('falls back to the per-credential interval when the 429 carries no Retry-After header', async () => {
    const sleep = jest.fn(async () => undefined);
    let call = 0;
    const fetchImpl = jest.fn(async () => {
      call += 1;
      return call === 1
        ? rateLimited(null)
        : ({ ok: true, status: 200, json: async () => accountsFixture } as unknown as Response);
    }) as unknown as typeof fetch;

    await fetchAccounts(CREDENTIALS, fetchImpl, { sleep });

    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it('falls back to the per-credential interval when Retry-After is a non-positive 0', async () => {
    const sleep = jest.fn(async () => undefined);
    let call = 0;
    const fetchImpl = jest.fn(async () => {
      call += 1;
      return call === 1
        ? rateLimited('0')
        : ({ ok: true, status: 200, json: async () => accountsFixture } as unknown as Response);
    }) as unknown as typeof fetch;

    await fetchAccounts(CREDENTIALS, fetchImpl, { sleep });

    expect(sleep).toHaveBeenCalledWith(60_000);
    expect(sleep).not.toHaveBeenCalledWith(0);
  });

  it('gives up after the bounded retry count and surfaces a distinct rate-limited error', async () => {
    const sleep = jest.fn(async () => undefined);
    const fetchImpl = jest.fn(async () => rateLimited('1')) as unknown as typeof fetch;

    await expect(
      fetchAccounts(CREDENTIALS, fetchImpl, { sleep, maxRetries: 2 }),
    ).rejects.toBeInstanceOf(PrivatbankRateLimitError);
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

      const pending = fetchAccounts(CREDENTIALS, fetchImpl, { timeoutMs: 30_000 });
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
      json: async () => accountsFixture,
    })) as unknown as typeof fetch;

    const result = await fetchAccounts(CREDENTIALS, fetchImpl);

    expect(result).toEqual(accountsFixture);
  });
});
