// T24 LIVE FETCH (2026-09-24): `GET https://bank.gov.ua/depo_securities?json`
// returned 200 with 196 records (187 DCP domestic OVDP, 9 OZDP Eurobonds) —
// `__fixtures__/depo-securities-sample.json` is 3 of those real records,
// trimmed to the fields `fetchNbuRegister` reads plus enough `payments[]` to
// stay realistic (spec 6.1/6.2). `UA4000234215`/`UA4000237077` are real DCP
// ISINs; `XS2895055981` is a real OZDP (Eurobond) ISIN with `nominal: 1`.
import depoSecuritiesSample from './__fixtures__/depo-securities-sample.json';
import { couponFrequencyFromPayPeriod, fetchNbuRegister } from './nbu-register';

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 500 })) as unknown as typeof fetch;

// `maturityDate` is parsed as DEVICE-LOCAL midnight (matching how every
// `BondMeta.maturityDate` consumer reads it), never `Date.UTC`. Building the
// expectation the SAME way the production code does keeps this assertion
// timezone-independent — it holds under any host TZ, not just Kyiv's.
const localMidnight = (year: number, month: number, day: number): number =>
  new Date(year, month - 1, day).getTime();

describe('couponFrequencyFromPayPeriod', () => {
  it('maps 182 (within 5 days of the semiannual band) to semiannually', () => {
    expect(couponFrequencyFromPayPeriod(182)).toBe('semiannually');
  });

  it('maps 200 (outside every band) to null', () => {
    expect(couponFrequencyFromPayPeriod(200)).toBeNull();
  });

  it('maps the monthly band edges (25 and 35) to monthly', () => {
    expect(couponFrequencyFromPayPeriod(25)).toBe('monthly');
    expect(couponFrequencyFromPayPeriod(35)).toBe('monthly');
  });

  it('maps the quarterly band edges (86 and 96) to quarterly', () => {
    expect(couponFrequencyFromPayPeriod(86)).toBe('quarterly');
    expect(couponFrequencyFromPayPeriod(96)).toBe('quarterly');
  });

  it('maps the annual band edges (359 and 369) to annually', () => {
    expect(couponFrequencyFromPayPeriod(359)).toBe('annually');
    expect(couponFrequencyFromPayPeriod(369)).toBe('annually');
  });

  it('maps just outside a band edge (24 and 36) to null', () => {
    expect(couponFrequencyFromPayPeriod(24)).toBeNull();
    expect(couponFrequencyFromPayPeriod(36)).toBeNull();
  });
});

describe('fetchNbuRegister', () => {
  it("requests NBU's securities-register endpoint without a token", async () => {
    let sentUrl = '';
    const spyFetch = (async (url: string) => {
      sentUrl = url;
      return { ok: true, json: async () => depoSecuritiesSample, status: 200 };
    }) as unknown as typeof fetch;

    await fetchNbuRegister(spyFetch);

    expect(sentUrl).toBe('https://bank.gov.ua/depo_securities?json');
  });

  it('maps a real DCP (domestic OVDP) record into BondTerms', async () => {
    const result = await fetchNbuRegister(makeFetch(depoSecuritiesSample));

    expect(result[0]).toEqual({
      isin: 'UA4000234215',
      currency: 'UAH',
      faceValueMinorUnits: 100_000,
      couponPct: 15.1,
      maturityDate: localMidnight(2026, 6, 24),
      couponFrequency: 'semiannually',
      name: 'Середньострокові UA4000234215',
    });
  });

  it('maps a real OZDP (Eurobond) record, converting its fractional nominal 1 to 100 minor units', async () => {
    const result = await fetchNbuRegister(makeFetch(depoSecuritiesSample));
    const eurobond = result.find((bond) => bond.isin === 'XS2895055981');

    expect(eurobond).toEqual({
      isin: 'XS2895055981',
      currency: 'USD',
      faceValueMinorUnits: 100,
      couponPct: 4.5,
      maturityDate: localMidnight(2029, 2, 1),
      couponFrequency: 'semiannually',
      name: 'OЗДП-середньострокова XS2895055981',
    });
  });

  it('maps every record in the fixture (none silently dropped)', async () => {
    const result = await fetchNbuRegister(makeFetch(depoSecuritiesSample));

    expect(result).toHaveLength(3);
  });

  it('drops a record whose currency the app does not model', async () => {
    const rows = [{ ...depoSecuritiesSample[0], val_code: 'XDR' }];

    const result = await fetchNbuRegister(makeFetch(rows));

    expect(result).toEqual([]);
  });

  it('drops a record with an unparseable maturity date', async () => {
    const rows = [{ ...depoSecuritiesSample[0], pgs_date: 'not-a-date' }];

    const result = await fetchNbuRegister(makeFetch(rows));

    expect(result).toEqual([]);
  });

  it('throws on a non-ok response', async () => {
    await expect(fetchNbuRegister(makeFetch({}, false))).rejects.toThrow('500');
  });
});
