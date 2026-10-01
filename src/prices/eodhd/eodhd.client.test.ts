import { logFailure } from '@kiko/diagnostics';

import {
  EodhdAuthError,
  EodhdNetworkError,
  EodhdNotInPlanError,
  EodhdQuotaError,
  EodhdRateLimitError,
  EodhdServerError,
  EodhdUnavailableError,
  fetchEod,
  fetchUserLimits,
  searchSymbols,
} from './eodhd.client';
import userFixture from './__fixtures__/user.json';
import eodAAPLFixture from './__fixtures__/eod-aapl.json';
import searchVODFixture from './__fixtures__/search-vod.json';

const KEY = 'fake-eodhd-key-0000';

const fromDay = Date.UTC(2026, 8, 1);
const toDay = Date.UTC(2026, 8, 3);

const respondWith = (body: unknown, status = 200): typeof fetch =>
  (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;

const recordUrl = (sent: string[], body: unknown): typeof fetch =>
  (async (url: string) => {
    sent.push(url);

    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;

describe('fetchEod', () => {
  it('requests the EOD endpoint for the symbol with the key, JSON format, and UTC YYYY-MM-DD bounds', async () => {
    const sent: string[] = [];

    await fetchEod('AAPL.US', fromDay, toDay, KEY, recordUrl(sent, eodAAPLFixture));

    const url = new URL(sent[0]);
    expect(`${url.origin}${url.pathname}`).toBe('https://eodhd.com/api/eod/AAPL.US');
    expect(url.searchParams.get('api_token')).toBe(KEY);
    expect(url.searchParams.get('fmt')).toBe('json');
    expect(url.searchParams.get('from')).toBe('2026-09-01');
    expect(url.searchParams.get('to')).toBe('2026-09-03');
  });

  it('formats the bounds in UTC, not in the device time zone', async () => {
    const sent: string[] = [];
    const lateInTheUTCDay = Date.UTC(2026, 8, 1, 23, 30);

    await fetchEod('AAPL.US', lateInTheUTCDay, lateInTheUTCDay, KEY, recordUrl(sent, []));

    const url = new URL(sent[0]);
    expect(url.searchParams.get('from')).toBe('2026-09-01');
    expect(url.searchParams.get('to')).toBe('2026-09-01');
  });

  it('maps each row to its UTC-midnight day and the close as an exact decimal string', async () => {
    const points = await fetchEod('AAPL.US', fromDay, toDay, KEY, respondWith(eodAAPLFixture));

    expect(points).toEqual([
      { day: Date.UTC(2026, 8, 1), close: '325.13' },
      { day: Date.UTC(2026, 8, 2), close: '324.96' },
      { day: Date.UTC(2026, 8, 3), close: '328.21' },
    ]);
  });

  it('returns no points for a range with no trading days', async () => {
    await expect(fetchEod('AAPL.US', fromDay, toDay, KEY, respondWith([]))).resolves.toEqual([]);
  });

  it('drops a row whose close is not a finite number or whose date is malformed', async () => {
    const rows = [
      { date: '2026-09-01', close: '325.13' },
      { date: '01.09.2026', close: 325.13 },
      { date: '2026-09-02', close: 324.96 },
    ];

    const points = await fetchEod('AAPL.US', fromDay, toDay, KEY, respondWith(rows));

    expect(points).toEqual([{ day: Date.UTC(2026, 8, 2), close: '324.96' }]);
  });

  it('drops a row whose date is not a real calendar day', async () => {
    const rows = [
      { date: '2026-02-30', close: 300 },
      { date: '2026-13-01', close: 301 },
      { date: '2026-09-02', close: 324.96 },
    ];

    const points = await fetchEod('AAPL.US', fromDay, toDay, KEY, respondWith(rows));

    expect(points).toEqual([{ day: Date.UTC(2026, 8, 2), close: '324.96' }]);
  });

  it('treats a body that is not a list as the provider being unavailable', async () => {
    await expect(
      fetchEod('AAPL.US', fromDay, toDay, KEY, respondWith({ error: 'x' })),
    ).rejects.toBeInstanceOf(EodhdUnavailableError);
  });
});

describe('fetchUserLimits', () => {
  it('requests the user endpoint with the key', async () => {
    const sent: string[] = [];

    await fetchUserLimits(KEY, recordUrl(sent, userFixture));

    const url = new URL(sent[0]);
    expect(`${url.origin}${url.pathname}`).toBe('https://eodhd.com/api/user');
    expect(url.searchParams.get('api_token')).toBe(KEY);
    expect(url.searchParams.get('fmt')).toBe('json');
  });

  it('reads the daily limit, the requests used, and their provider day', async () => {
    await expect(fetchUserLimits(KEY, respondWith(userFixture))).resolves.toEqual({
      dailyLimit: 20,
      requestsToday: 12,
      requestsDay: Date.UTC(2026, 8, 30),
    });
  });

  it('treats a payload without the limit fields as the provider being unavailable', async () => {
    await expect(
      fetchUserLimits(KEY, respondWith({ ...userFixture, dailyRateLimit: '20' })),
    ).rejects.toBeInstanceOf(EodhdUnavailableError);
  });
});

describe('searchSymbols', () => {
  it('requests the search endpoint for the query with the key, JSON format, and the exchange', async () => {
    const sent: string[] = [];

    await searchSymbols('VOD', KEY, recordUrl(sent, searchVODFixture), 'LSE');

    const url = new URL(sent[0]);
    expect(`${url.origin}${url.pathname}`).toBe('https://eodhd.com/api/search/VOD');
    expect(url.searchParams.get('api_token')).toBe(KEY);
    expect(url.searchParams.get('fmt')).toBe('json');
    expect(url.searchParams.get('exchange')).toBe('LSE');
  });

  it('sends no exchange filter when none is given', async () => {
    const sent: string[] = [];

    await searchSymbols('GB00BH4HKS39', KEY, recordUrl(sent, searchVODFixture));

    expect(new URL(sent[0]).searchParams.has('exchange')).toBe(false);
  });

  it('maps each listing to its CODE.EXCHANGE symbol, name, ISIN, currency unit, and primary flag', async () => {
    await expect(searchSymbols('VOD', KEY, respondWith(searchVODFixture), 'LSE')).resolves.toEqual([
      {
        symbol: 'VOD.LSE',
        name: 'Vodafone Group PLC',
        isin: 'GB00BH4HKS39',
        currency: 'GBX',
        isPrimary: true,
      },
      { symbol: '0LQQ.LSE', name: 'Example Corp', currency: 'USD', isPrimary: false },
      {
        symbol: '3SVO.LSE',
        name: 'Example ETP',
        isin: 'XS2710197935',
        currency: 'GBX',
        isPrimary: false,
      },
    ]);
  });

  it('reads a listing with no primary flag as not primary', async () => {
    const { isPrimary: _isPrimary, ...listing } = searchVODFixture[0];

    await expect(searchSymbols('VOD', KEY, respondWith([listing]))).resolves.toEqual([
      expect.objectContaining({ symbol: 'VOD.LSE', isPrimary: false }),
    ]);
  });

  it('drops a listing without a code, an exchange, a name, or a currency', async () => {
    const [listing] = searchVODFixture;
    const rows = [
      { ...listing, Code: 1 },
      { ...listing, Exchange: null },
      { ...listing, Name: undefined },
      { ...listing, Currency: 7 },
      { ...listing, Code: 'VOD2' },
    ];

    await expect(searchSymbols('VOD', KEY, respondWith(rows))).resolves.toEqual([
      {
        symbol: 'VOD2.LSE',
        name: 'Vodafone Group PLC',
        isin: 'GB00BH4HKS39',
        currency: 'GBX',
        isPrimary: true,
      },
    ]);
  });

  it('treats a body that is not a list as the provider being unavailable', async () => {
    await expect(searchSymbols('VOD', KEY, respondWith({ error: 'x' }))).rejects.toBeInstanceOf(
      EodhdUnavailableError,
    );
  });
});

const failures: [string, typeof fetch, new () => Error][] = [
  ['401', respondWith('Unauthenticated', 401), EodhdAuthError],
  ['402', respondWith('Payment required', 402), EodhdQuotaError],
  ['403', respondWith('Forbidden', 403), EodhdNotInPlanError],
  ['404', respondWith('Not found', 404), EodhdUnavailableError],
  ['429', respondWith('Too many requests', 429), EodhdRateLimitError],
  ['500', respondWith('Server error', 500), EodhdServerError],
  ['503', respondWith('Service unavailable', 503), EodhdServerError],
  [
    'a network failure',
    (async (url: string) => {
      throw new TypeError(`Network request failed: ${url}`);
    }) as unknown as typeof fetch,
    EodhdNetworkError,
  ],
  [
    'an invalid JSON body',
    (async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError(`Unexpected token in ${KEY}`);
      },
    })) as unknown as typeof fetch,
    EodhdUnavailableError,
  ],
];

const calls: [string, (fetchImpl: typeof fetch) => Promise<unknown>][] = [
  ['fetchEod', (fetchImpl) => fetchEod('AAPL.US', fromDay, toDay, KEY, fetchImpl)],
  ['fetchUserLimits', (fetchImpl) => fetchUserLimits(KEY, fetchImpl)],
  ['searchSymbols', (fetchImpl) => searchSymbols('VOD', KEY, fetchImpl, 'LSE')],
];

describe.each(calls)('%s request', (_name, call) => {
  it('asks every cache not to store the response of a URL that carries the key', async () => {
    const sent: { url: string; init?: RequestInit }[] = [];
    const spyFetch = (async (url: string, init?: RequestInit) => {
      sent.push({ url, init });

      return { ok: true, status: 200, json: async () => userFixture };
    }) as unknown as typeof fetch;

    await call(spyFetch).catch(() => undefined);

    expect(sent[0].init?.headers).toEqual({ 'Cache-Control': 'no-store' });
    expect(new URL(sent[0].url).searchParams.has('_')).toBe(false);
    expect(sent[0].init).not.toHaveProperty('cache');
  });
});

describe.each(calls)('%s timeout', (_name, call) => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('aborts a request with no answer after 30 seconds as a network error', async () => {
    jest.useFakeTimers();
    const hungFetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error(`Aborted ${KEY}`), { name: 'AbortError' }));
        });
      })) as unknown as typeof fetch;

    const assertion = expect(call(hungFetch)).rejects.toBeInstanceOf(EodhdNetworkError);

    await jest.advanceTimersByTimeAsync(29_999);
    await jest.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('leaves no timer behind once the answer arrives', async () => {
    jest.useFakeTimers();

    await call(respondWith(userFixture)).catch(() => undefined);

    expect(jest.getTimerCount()).toBe(0);
  });
});

describe.each(calls)('%s failures', (_name, call) => {
  it.each(failures)('maps %s to its own error class', async (_status, fetchImpl, errorClass) => {
    await expect(call(fetchImpl)).rejects.toBeInstanceOf(errorClass);
  });

  it.each(failures)('never puts the key in the error for %s', async (_status, fetchImpl) => {
    const error = await call(fetchImpl).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect((error as Error).message).not.toContain(KEY);
    expect(String((error as Error).stack)).not.toContain(KEY);
  });

  it.each(failures)('never puts the key in a logged failure for %s', async (_status, fetchImpl) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = await call(fetchImpl).catch((caught: unknown) => caught);

    logFailure('[eodhd]', error);

    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
    warn.mockRestore();
  });
});
