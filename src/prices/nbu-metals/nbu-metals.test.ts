// A live probe of `GET
// https://bank.gov.ua/NBU_Exchange/exchange_site?start=20250101&end=20250110&valcode=xau&json`
// returned 200 with one row PER DAY (weekend/holiday days carry forward the last
// banking day's rate, e.g. 04.01/05.01.2025 both echo 03.01's 111145.17) — so the
// RANGE path applies, one call per metal, exactly like `nbu-history.ts`'s USD/EUR
// fetch. A second probe of `GET
// https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json` (the same
// CURRENT endpoint `nbu-rates.ts` already reads for fiat) confirmed XAU/XAG/XPT/XPD
// rows are present in that SAME payload, with no `units` field observed on a metal
// row — so `fetchNbuMetalsCurrent` reads that shared endpoint instead of issuing a
// second one.
import { fetchNbuMetalHistory, fetchNbuMetalsCurrent } from './nbu-metals';

type NbuCurrentRow = { r030: number; txt: string; rate: number; cc: string; exchangedate: string };

const currentFixture: NbuCurrentRow[] = [
  { r030: 840, txt: 'Долар США', rate: 44.7863, cc: 'USD', exchangedate: '24.09.2026' },
  { r030: 959, txt: 'Золото', rate: 193295.79, cc: 'XAU', exchangedate: '24.09.2026' },
  { r030: 961, txt: 'Срібло', rate: 2919.24, cc: 'XAG', exchangedate: '24.09.2026' },
  { r030: 962, txt: 'Платина', rate: 79652.08, cc: 'XPT', exchangedate: '24.09.2026' },
  { r030: 964, txt: 'Паладій', rate: 57079.09, cc: 'XPD', exchangedate: '24.09.2026' },
  // A code the NBU quotes that our app doesn't model (SDR) -> dropped.
  { r030: 960, txt: 'СПЗ', rate: 61.2, cc: 'XDR', exchangedate: '24.09.2026' },
];

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 500 })) as unknown as typeof fetch;

describe('fetchNbuMetalsCurrent', () => {
  it("requests NBU's current exchange endpoint without a token", async () => {
    let sentUrl = '';
    const spyFetch = (async (url: string) => {
      sentUrl = url;
      return { ok: true, json: async () => currentFixture, status: 200 };
    }) as unknown as typeof fetch;

    await fetchNbuMetalsCurrent(spyFetch);

    expect(sentUrl).toBe('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json');
  });

  it('maps every precious metal NBU quotes into metal:XAU-style UAH decimal-string points', async () => {
    const result = await fetchNbuMetalsCurrent(makeFetch(currentFixture));

    expect(result).toEqual([
      { metal: 'XAU', price: '193295.79' },
      { metal: 'XAG', price: '2919.24' },
      { metal: 'XPT', price: '79652.08' },
      { metal: 'XPD', price: '57079.09' },
    ]);
  });

  it('throws on a non-ok response', async () => {
    await expect(fetchNbuMetalsCurrent(makeFetch({}, false))).rejects.toThrow('500');
  });
});

type NbuRangeRow = {
  exchangedate: string;
  r030: number;
  cc: string;
  rate: number;
  units: number;
  rate_per_unit?: number;
};

const xauRows: NbuRangeRow[] = [
  {
    exchangedate: '01.01.2025',
    r030: 959,
    cc: 'XAU',
    rate: 109765.92,
    units: 1,
    rate_per_unit: 109765.92,
  },
  {
    exchangedate: '02.01.2025',
    r030: 959,
    cc: 'XAU',
    rate: 109583.9,
    units: 1,
    rate_per_unit: 109583.9,
  },
];

describe('fetchNbuMetalHistory', () => {
  const start = Date.UTC(2025, 0, 1);
  const end = Date.UTC(2025, 0, 2);

  it('requests the NBU range endpoint for one metal with a lowercase valcode and YYYYMMDD dates', async () => {
    let sentUrl = '';
    const spyFetch = (async (url: string) => {
      sentUrl = url;
      return { ok: true, status: 200, json: async () => xauRows };
    }) as unknown as typeof fetch;

    await fetchNbuMetalHistory('XAU', start, end, spyFetch);

    const params = new URL(sentUrl).searchParams;
    expect(sentUrl.startsWith('https://bank.gov.ua/NBU_Exchange/exchange_site')).toBe(true);
    expect(params.get('start')).toBe('20250101');
    expect(params.get('end')).toBe('20250102');
    expect(params.get('valcode')).toBe('xau');
  });

  it('parses UAH-per-troy-ounce rows into day-normalized history points', async () => {
    const result = await fetchNbuMetalHistory('XAU', start, end, makeFetch(xauRows));

    expect(result).toEqual([
      { metal: 'XAU', day: Date.UTC(2025, 0, 1), price: '109765.92' },
      { metal: 'XAU', day: Date.UTC(2025, 0, 2), price: '109583.9' },
    ]);
  });

  it('divides by units when rate_per_unit is absent', async () => {
    const rows: NbuRangeRow[] = [
      { exchangedate: '01.01.2025', r030: 959, cc: 'XAU', rate: 219531.84, units: 2 },
    ];

    const result = await fetchNbuMetalHistory('XAU', start, end, makeFetch(rows));

    expect(result).toEqual([{ metal: 'XAU', day: Date.UTC(2025, 0, 1), price: '109765.92' }]);
  });

  it('throws on a non-ok response', async () => {
    await expect(fetchNbuMetalHistory('XAU', start, end, makeFetch({}, false))).rejects.toThrow(
      '500',
    );
  });
});
