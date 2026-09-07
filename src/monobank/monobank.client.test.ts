import clientInfo from './__fixtures__/client-info.json';
import statement from './__fixtures__/statement.json';
import {
  fetchClientInfo,
  fetchStatement,
  MonobankRateLimitError,
  MonobankTimeoutError,
} from './monobank.client';

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 500 })) as unknown as typeof fetch;

type SpyFetchInit = { headers: Record<string, string> };

describe('fetchClientInfo', () => {
  it('sends the X-Token header and returns parsed accounts and jars', async () => {
    let sentUrl = '';
    let sentHeaders: Record<string, string> = {};
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentHeaders = init.headers;
      return { ok: true, json: async () => clientInfo, status: 200 };
    }) as unknown as typeof fetch;

    const result = await fetchClientInfo('secret', spyFetch);

    expect(sentUrl).toBe('https://api.monobank.ua/personal/client-info');
    expect(sentHeaders['X-Token']).toBe('secret');
    expect(result.accounts.length).toBeGreaterThan(0);
    expect(result.accounts[0].currencyCode).toBe(980);
    expect(result.accounts[0].maskedPan[0]).toContain('*');
    expect(result.jars?.[0].goal).toBe(20000000);
    expect(result.clientId).toBe('3MSaMMtczs');
  });

  it('throws on a non-ok, non-429 response', async () => {
    await expect(fetchClientInfo('secret', makeFetch({}, false))).rejects.toThrow('500');
  });
});

describe('fetchStatement', () => {
  it('sends the X-Token header, builds the windowed path, and returns typed items', async () => {
    let sentUrl = '';
    let sentHeaders: Record<string, string> = {};
    const spyFetch = (async (url: string, init: SpyFetchInit) => {
      sentUrl = url;
      sentHeaders = init.headers;
      return { ok: true, json: async () => statement, status: 200 };
    }) as unknown as typeof fetch;

    const result = await fetchStatement('secret', 'acc-1', 1704067200, 1704240000, spyFetch);

    expect(sentUrl).toBe('https://api.monobank.ua/personal/statement/acc-1/1704067200/1704240000');
    expect(sentHeaders['X-Token']).toBe('secret');
    expect(result.length).toBe(3);
    expect(result.some((item) => item.amount < 0)).toBe(true);
    expect(result.some((item) => item.amount > 0)).toBe(true);
    expect(result[0].id).toBe('ZuHWzqkKGVo=');
  });

  it('throws on a non-ok, non-429 response', async () => {
    await expect(
      fetchStatement('secret', 'acc-1', 1704067200, 1704240000, makeFetch({}, false)),
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
        : ({ ok: true, status: 200, json: async () => clientInfo } as unknown as Response);
    }) as unknown as typeof fetch;

    const result = await fetchClientInfo('secret', fetchImpl, { sleep });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Retry-After is expressed in seconds; the backoff is that many milliseconds.
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(result.accounts.length).toBeGreaterThan(0);
  });

  it('falls back to the per-token interval when the 429 carries no Retry-After header', async () => {
    const sleep = jest.fn(async () => undefined);
    let call = 0;
    const fetchImpl = jest.fn(async () => {
      call += 1;
      return call === 1
        ? rateLimited(null)
        : ({ ok: true, status: 200, json: async () => clientInfo } as unknown as Response);
    }) as unknown as typeof fetch;

    await fetchClientInfo('secret', fetchImpl, { sleep });

    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it('gives up after the bounded retry count and surfaces a distinct rate-limited error', async () => {
    const sleep = jest.fn(async () => undefined);
    const fetchImpl = jest.fn(async () => rateLimited('1')) as unknown as typeof fetch;

    await expect(
      fetchClientInfo('secret', fetchImpl, { sleep, maxRetries: 2 }),
    ).rejects.toBeInstanceOf(MonobankRateLimitError);
    // one initial attempt plus two retries
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

      const pending = fetchClientInfo('secret', fetchImpl, { timeoutMs: 30_000 });
      const assertion = expect(pending).rejects.toBeInstanceOf(MonobankTimeoutError);

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
      json: async () => clientInfo,
    })) as unknown as typeof fetch;

    const result = await fetchClientInfo('secret', fetchImpl);

    expect(result.accounts.length).toBeGreaterThan(0);
  });
});
