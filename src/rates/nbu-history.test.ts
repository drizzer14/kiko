import { fetchNbuHistory } from './nbu-history';

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
const eurRows: NbuRow[] = [
  { exchangedate: '02.09.2026', r030: 978, cc: 'EUR', rate: 51.5357, units: 1 },
];

/** A fetch double that answers per-currency based on the `valcode` query param. */
const makeFetch = (byValcode: Record<string, NbuRow[]>, ok = true): typeof fetch =>
  (async (url: string) => {
    const valcode = new URL(url).searchParams.get('valcode') ?? '';
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => byValcode[valcode] ?? [],
    };
  }) as unknown as typeof fetch;

describe('fetchNbuHistory', () => {
  const start = Date.UTC(2026, 8, 1); // 2026-09-01
  const end = Date.UTC(2026, 8, 2); // 2026-09-02

  it('requests the NBU range endpoint per currency with YYYYMMDD dates', async () => {
    const urls: string[] = [];
    const spyFetch = (async (url: string) => {
      urls.push(url);
      const valcode = new URL(url).searchParams.get('valcode') ?? '';
      return { ok: true, status: 200, json: async () => (valcode === 'usd' ? usdRows : eurRows) };
    }) as unknown as typeof fetch;

    await fetchNbuHistory(start, end, spyFetch);

    expect(urls).toHaveLength(2);
    for (const url of urls) {
      const params = new URL(url).searchParams;
      expect(url.startsWith('https://bank.gov.ua/NBU_Exchange/exchange_site')).toBe(true);
      expect(params.get('start')).toBe('20260901');
      expect(params.get('end')).toBe('20260902');
      expect(params.get('json')).toBe('');
    }
    expect(urls.some((u) => new URL(u).searchParams.get('valcode') === 'usd')).toBe(true);
    expect(urls.some((u) => new URL(u).searchParams.get('valcode') === 'eur')).toBe(true);
  });

  it('parses UAH-per-currency rows into day-normalized USD/EUR entries', async () => {
    const result = await fetchNbuHistory(start, end, makeFetch({ usd: usdRows, eur: eurRows }));

    expect(result).toContainEqual({
      base: 'USD',
      quote: 'UAH',
      day: Date.UTC(2026, 8, 2),
      rate: 44.4553,
      source: 'nbu',
    });
    expect(result).toContainEqual({
      base: 'USD',
      quote: 'UAH',
      day: Date.UTC(2026, 8, 1),
      rate: 44.5249,
      source: 'nbu',
    });
    expect(result).toContainEqual({
      base: 'EUR',
      quote: 'UAH',
      day: Date.UTC(2026, 8, 2),
      rate: 51.5357,
      source: 'nbu',
    });
  });

  it('prefers rate_per_unit and divides by units when they differ', async () => {
    const rows: NbuRow[] = [
      { exchangedate: '01.09.2026', r030: 840, cc: 'USD', rate: 89, units: 2, rate_per_unit: 44.5 },
    ];
    const result = await fetchNbuHistory(start, end, makeFetch({ usd: rows, eur: [] }));

    expect(result).toContainEqual({
      base: 'USD',
      quote: 'UAH',
      day: Date.UTC(2026, 8, 1),
      rate: 44.5,
      source: 'nbu',
    });
  });

  it('throws on a non-ok response', async () => {
    await expect(fetchNbuHistory(start, end, makeFetch({}, false))).rejects.toThrow('500');
  });
});
