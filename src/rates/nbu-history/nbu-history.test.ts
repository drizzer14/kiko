import { fetchNbuHistory, NBU_HISTORY_REQUEST_INTERVAL_MS } from './nbu-history';

type NbuRow = {
  exchangedate: string;
  r030: number;
  cc: string;
  rate: number;
  units: number;
  rate_per_unit?: number;
};

const usdRows: NbuRow[] = [
  { exchangedate: '02.09.2026', r030: 840, cc: 'USD', rate: 44.4553, units: 1 },
  { exchangedate: '01.09.2026', r030: 840, cc: 'USD', rate: 44.5249, units: 1 },
];
const gbpRows: NbuRow[] = [
  { exchangedate: '02.09.2026', r030: 826, cc: 'GBP', rate: 51.5357, units: 1 },
];

/** A fake clock/sleep pair, so a multi-currency fetch never waits out the real request-gate interval. */
const fakeSleepDeps = (): { now: () => number; sleep: (milliseconds: number) => Promise<void> } => {
  let elapsed = 0;

  return {
    now: () => elapsed,
    sleep: async (milliseconds: number) => {
      elapsed += milliseconds;
    },
  };
};

/** A fetch double that answers per-currency based on the `valcode` query param. */
const makeFetch = (byValcode: Record<string, NbuRow[]>, okValcodes?: Set<string>): typeof fetch =>
  (async (url: string) => {
    const valcode = new URL(url).searchParams.get('valcode') ?? '';
    const ok = okValcodes === undefined || okValcodes.has(valcode);

    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => byValcode[valcode] ?? [],
    };
  }) as unknown as typeof fetch;

describe('fetchNbuHistory', () => {
  const start = Date.UTC(2026, 8, 1); // 2026-09-01
  const end = Date.UTC(2026, 8, 2); // 2026-09-02

  it('makes zero requests for an empty currency list', async () => {
    const fetchImpl = jest.fn();

    const result = await fetchNbuHistory([], start, end, { fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ entries: [], failedCurrencies: [] });
  });

  it('requests the NBU range endpoint per currency with YYYYMMDD dates', async () => {
    const urls: string[] = [];
    const spyFetch = (async (url: string) => {
      urls.push(url);
      const valcode = new URL(url).searchParams.get('valcode') ?? '';

      return { ok: true, status: 200, json: async () => (valcode === 'usd' ? usdRows : gbpRows) };
    }) as unknown as typeof fetch;

    await fetchNbuHistory(['USD', 'GBP'], start, end, { fetchImpl: spyFetch, ...fakeSleepDeps() });

    expect(urls).toHaveLength(2);

    for (const url of urls) {
      const params = new URL(url).searchParams;
      expect(url.startsWith('https://bank.gov.ua/NBU_Exchange/exchange_site')).toBe(true);
      expect(params.get('start')).toBe('20260901');
      expect(params.get('end')).toBe('20260902');
      expect(params.get('json')).toBe('');
    }
    expect(urls.some((u) => new URL(u).searchParams.get('valcode') === 'usd')).toBe(true);
    expect(urls.some((u) => new URL(u).searchParams.get('valcode') === 'gbp')).toBe(true);
  });

  it('parses UAH-per-currency rows into day-normalized entries, tagged by currency', async () => {
    const result = await fetchNbuHistory(['USD', 'GBP'], start, end, {
      fetchImpl: makeFetch({ usd: usdRows, gbp: gbpRows }),
      ...fakeSleepDeps(),
    });

    expect(result.entries).toContainEqual({
      base: 'USD',
      quote: 'UAH',
      day: Date.UTC(2026, 8, 2),
      rate: 44.4553,
      source: 'nbu',
    });
    expect(result.entries).toContainEqual({
      base: 'USD',
      quote: 'UAH',
      day: Date.UTC(2026, 8, 1),
      rate: 44.5249,
      source: 'nbu',
    });
    expect(result.entries).toContainEqual({
      base: 'GBP',
      quote: 'UAH',
      day: Date.UTC(2026, 8, 2),
      rate: 51.5357,
      source: 'nbu',
    });
    expect(result.failedCurrencies).toEqual([]);
  });

  it('prefers rate_per_unit and divides by units when they differ', async () => {
    const rows: NbuRow[] = [
      { exchangedate: '01.09.2026', r030: 840, cc: 'USD', rate: 89, units: 2, rate_per_unit: 44.5 },
    ];
    const result = await fetchNbuHistory(['USD'], start, end, {
      fetchImpl: makeFetch({ usd: rows }),
    });

    expect(result.entries).toContainEqual({
      base: 'USD',
      quote: 'UAH',
      day: Date.UTC(2026, 8, 1),
      rate: 44.5,
      source: 'nbu',
    });
  });

  it('drops a row with a zero units divisor, a non-finite rate, or a zero rate', async () => {
    const rows: NbuRow[] = [
      { exchangedate: '01.09.2026', r030: 840, cc: 'USD', rate: 40, units: 0 },
      { exchangedate: '02.09.2026', r030: 840, cc: 'USD', rate: Number.NaN, units: 1 },
      { exchangedate: '03.09.2026', r030: 840, cc: 'USD', rate: 0, units: 1 },
    ];
    const result = await fetchNbuHistory(['USD'], start, end, {
      fetchImpl: makeFetch({ usd: rows }),
    });

    expect(result.entries).toEqual([]);
  });

  it('divides a plain 100-unit row by its own units', async () => {
    const rows: NbuRow[] = [
      { exchangedate: '01.09.2026', r030: 392, cc: 'JPY', rate: 28.72, units: 100 },
    ];
    const result = await fetchNbuHistory(['JPY'], start, end, {
      fetchImpl: makeFetch({ jpy: rows }),
    });

    expect(result.entries).toContainEqual({
      base: 'JPY',
      quote: 'UAH',
      day: Date.UTC(2026, 8, 1),
      rate: 0.2872,
      source: 'nbu',
    });
  });

  it('never rejects: a failed currency lands in failedCurrencies, the others still resolve', async () => {
    const result = await fetchNbuHistory(['USD', 'PLN'], start, end, {
      fetchImpl: makeFetch({ usd: usdRows }, new Set(['usd'])),
      ...fakeSleepDeps(),
    });

    expect(result.entries.every((entry) => entry.base === 'USD')).toBe(true);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.failedCurrencies).toEqual(['PLN']);
  });

  it('spaces sequential requests by at least the request interval, via an injected sleep', async () => {
    let now = 0;
    const sleep = jest.fn(async (milliseconds: number) => {
      now += milliseconds;
    });

    await fetchNbuHistory(['USD', 'GBP', 'PLN'], start, end, {
      fetchImpl: makeFetch({ usd: usdRows, gbp: gbpRows, pln: [] }),
      now: () => now,
      sleep,
    });

    expect(sleep).toHaveBeenCalledTimes(2);

    for (const call of sleep.mock.calls) {
      expect(call[0]).toBeGreaterThanOrEqual(NBU_HISTORY_REQUEST_INTERVAL_MS);
    }
  });
});
