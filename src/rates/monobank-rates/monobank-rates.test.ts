import { Money } from '../../currency/money';
import { convert } from '../conversion';

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
  { currencyCodeA: 840, currencyCodeB: 980, date: 1, rateBuy: 39, rateSell: 41 }, // USD:UAH -> buy 39
  { currencyCodeA: 978, currencyCodeB: 980, date: 1, rateCross: 43 }, // EUR:UAH cross 43
  { currencyCodeA: 840, currencyCodeB: 978, date: 1, rateSell: 0.93 }, // USD:EUR sell-only
  { currencyCodeA: 392, currencyCodeB: 980, date: 1, rateBuy: 0.27, rateSell: 0.28 }, // JPY:UAH -> dropped
  { currencyCodeA: 985, currencyCodeB: 980, date: 1 }, // no rate at all -> dropped
];

// A holding of a foreign currency is a bank ASSET: monobank values it at its
// BUY price (what the bank pays to buy that currency from you), which is lower
// than the buy/sell midpoint. This is the field that reproduces the in-app value.
const liveUsdUah: MonoRate[] = [
  { currencyCodeA: 840, currencyCodeB: 980, date: 1, rateBuy: 44.46, rateSell: 44.831 },
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
      // USD:UAH has buy+sell, so it values the asset at the bank BUY price (39),
      // not the buy/sell midpoint (40).
      { base: 'USD', quote: 'UAH', rate: 39, source: 'monobank' },
      { base: 'EUR', quote: 'UAH', rate: 43, source: 'monobank' },
      { base: 'USD', quote: 'EUR', rate: 0.93, source: 'monobank' },
    ]);
  });

  it('values a 4000 USD holding at the buy rate to match the monobank app', async () => {
    const [usdUah] = await fetchFiatRates(makeFetch(liveUsdUah));

    // rateBuy 44.46 is the field that reproduces monobank's in-app value; the
    // midpoint (44.6455) would overvalue the holding by ~742 UAH.
    expect(usdUah).toEqual({ base: 'USD', quote: 'UAH', rate: 44.46, source: 'monobank' });

    const rates = { [`${usdUah.base}:${usdUah.quote}`]: usdUah.rate };
    const converted = convert(Money.fromMajor('USD', 4000), 'UAH', rates);

    expect(converted).toEqual(Money.fromMajor('UAH', 177840));
  });

  it('throws on a non-ok response', async () => {
    await expect(fetchFiatRates(makeFetch({}, false))).rejects.toThrow('429');
  });
});
