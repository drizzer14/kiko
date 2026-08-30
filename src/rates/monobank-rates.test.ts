import { fetchFiatRates } from './monobank-rates';

type MonoRate = {
  currencyCodeA: number;
  currencyCodeB: number;
  date: number;
  rateSell?: number;
  rateBuy?: number;
  rateCross?: number;
};

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 429 })) as unknown as typeof fetch;

const fixture: MonoRate[] = [
  { currencyCodeA: 840, currencyCodeB: 980, date: 1, rateBuy: 39, rateSell: 41 }, // USD:UAH midpoint 40
  { currencyCodeA: 978, currencyCodeB: 980, date: 1, rateCross: 43 }, // EUR:UAH cross 43
  { currencyCodeA: 840, currencyCodeB: 978, date: 1, rateSell: 0.93 }, // USD:EUR sell-only
  { currencyCodeA: 392, currencyCodeB: 980, date: 1, rateBuy: 0.27, rateSell: 0.28 }, // JPY:UAH -> dropped
  { currencyCodeA: 985, currencyCodeB: 980, date: 1 }, // no rate at all -> dropped
];

describe('fetchFiatRates', () => {
  it('requests the public currency endpoint without a token', async () => {
    let sentUrl = '';
    const spyFetch = (async (url: string) => {
      sentUrl = url;
      return { ok: true, json: async () => fixture, status: 200 };
    }) as unknown as typeof fetch;

    await fetchFiatRates(spyFetch);

    expect(sentUrl).toBe('https://api.monobank.ua/bank/currency');
  });

  it('normalizes entries within the fiat set and derives the rate per entry', async () => {
    const result = await fetchFiatRates(makeFetch(fixture));

    expect(result).toEqual([
      { base: 'USD', quote: 'UAH', rate: 40, source: 'monobank' },
      { base: 'EUR', quote: 'UAH', rate: 43, source: 'monobank' },
      { base: 'USD', quote: 'EUR', rate: 0.93, source: 'monobank' },
    ]);
  });

  it('throws on a non-ok response', async () => {
    await expect(fetchFiatRates(makeFetch({}, false))).rejects.toThrow('429');
  });
});
