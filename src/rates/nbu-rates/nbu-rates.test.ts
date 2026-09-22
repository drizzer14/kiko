import { fetchNbuFiatRates } from './nbu-rates';

type NbuExchangeRow = {
  r030: number;
  txt: string;
  rate: number;
  cc: string;
  exchangedate: string;
  units?: number;
};

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 500 })) as unknown as typeof fetch;

const fixture: NbuExchangeRow[] = [
  { r030: 840, txt: 'Долар США', rate: 44.7863, cc: 'USD', exchangedate: '23.09.2026' },
  { r030: 978, txt: 'Євро', rate: 51.3345, cc: 'EUR', exchangedate: '23.09.2026' },
  { r030: 826, txt: 'Фунт стерлінгів', rate: 60.5, cc: 'GBP', exchangedate: '23.09.2026' },
  { r030: 12, txt: 'Алжирський динар', rate: 0.33482, cc: 'DZD', exchangedate: '23.09.2026' },
  // A code the NBU quotes that our app doesn't model (a metal/SDR unit) -> dropped.
  { r030: 960, txt: 'СПЗ', rate: 61.2, cc: 'XDR', exchangedate: '23.09.2026' },
];

describe('fetchNbuFiatRates', () => {
  it("requests NBU's current exchange endpoint without a token", async () => {
    let sentUrl = '';
    const spyFetch = (async (url: string) => {
      sentUrl = url;
      return { ok: true, json: async () => fixture, status: 200 };
    }) as unknown as typeof fetch;

    await fetchNbuFiatRates(spyFetch);

    expect(sentUrl).toBe('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json');
  });

  it('maps every currency NBU quotes that our app also supports, in UAH-per-unit form', async () => {
    const result = await fetchNbuFiatRates(makeFetch(fixture));

    expect(result).toEqual([
      { base: 'USD', quote: 'UAH', rate: 44.7863, source: 'nbu' },
      { base: 'EUR', quote: 'UAH', rate: 51.3345, source: 'nbu' },
      { base: 'GBP', quote: 'UAH', rate: 60.5, source: 'nbu' },
      { base: 'DZD', quote: 'UAH', rate: 0.33482, source: 'nbu' },
    ]);
  });

  it('divides by units when a row quotes a rate per more than one unit', async () => {
    const rows: NbuExchangeRow[] = [
      { r030: 392, txt: 'Єна', rate: 28.499, cc: 'JPY', exchangedate: '23.09.2026', units: 100 },
    ];

    const result = await fetchNbuFiatRates(makeFetch(rows));

    expect(result).toHaveLength(1);
    expect(result[0]?.rate).toBeCloseTo(0.28499, 10);
    expect(result[0]).toMatchObject({ base: 'JPY', quote: 'UAH', source: 'nbu' });
  });

  it('throws on a non-ok response', async () => {
    await expect(fetchNbuFiatRates(makeFetch({}, false))).rejects.toThrow('500');
  });
});
