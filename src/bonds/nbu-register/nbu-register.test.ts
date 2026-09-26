// A live `GET https://bank.gov.ua/depo_securities?json` fetch
// returned 200 with 196 records (187 DCP domestic OVDP, 9 OZDP Eurobonds) —
// `__fixtures__/depo-securities-sample.json` holds real records trimmed to the
// fields `fetchNbuRegister` reads plus their `payments[]`. `UA4000234215`/
// `UA4000237077`/`UA4000239115` are real DCP ISINs; `XS2895055981` is a real
// OZDP (Eurobond) ISIN with `nominal: 1` and a step-up coupon (0.00875 per
// 1 nominal in 2025, 0.0225 to 2027-02, 0.03 from 2027-08).
import depoSecuritiesSample from './__fixtures__/depo-securities-sample.json';
import { couponFrequencyFromPayPeriod, couponPeriodDays, fetchNbuRegister } from './nbu-register';

const makeFetch = (body: unknown, ok = true): typeof fetch =>
  (async () => ({ ok, json: async () => body, status: ok ? 200 : 500 })) as unknown as typeof fetch;

// `maturityDate` is parsed as DEVICE-LOCAL midnight (matching how every
// `BondMeta.maturityDate` consumer reads it), never `Date.UTC`. Building the
// expectation the SAME way the production code does keeps this assertion
// timezone-independent — it holds under any host TZ, not just Kyiv's.
const localMidnight = (year: number, month: number, day: number): number =>
  new Date(year, month - 1, day).getTime();

const today = localMidnight(2026, 9, 26);

const registerRow = (isin: string) => {
  const row = depoSecuritiesSample.find((candidate) => candidate.cpcode === isin);

  if (row === undefined) {
    throw new Error(`fixture has no ${isin}`);
  }

  return row;
};

const couponOf = async (rows: unknown, now: number): Promise<number | undefined> => {
  const result = await fetchNbuRegister(makeFetch(rows), now);

  return result.at(0)?.couponPct;
};

describe('couponFrequencyFromPayPeriod', () => {
  it('maps 182 (within 5 days of the semiannual band) to semiannually', () => {
    expect(couponFrequencyFromPayPeriod(182)).toBe('semiannually');
  });

  it('maps the register periods 182/183, 364/365 and 91/92 to their frequencies', () => {
    expect(couponFrequencyFromPayPeriod(183)).toBe('semiannually');
    expect(couponFrequencyFromPayPeriod(364)).toBe('annually');
    expect(couponFrequencyFromPayPeriod(365)).toBe('annually');
    expect(couponFrequencyFromPayPeriod(91)).toBe('quarterly');
    expect(couponFrequencyFromPayPeriod(92)).toBe('quarterly');
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

describe('couponPeriodDays', () => {
  it("returns each frequency's canonical register period", () => {
    expect(couponPeriodDays('monthly')).toBe(30);
    expect(couponPeriodDays('quarterly')).toBe(91);
    expect(couponPeriodDays('semiannually')).toBe(182);
    expect(couponPeriodDays('annually')).toBe(364);
  });
});

describe('fetchNbuRegister', () => {
  it("requests NBU's securities-register endpoint without a token", async () => {
    let sentUrl = '';
    const spyFetch = (async (url: string) => {
      sentUrl = url;

      return { ok: true, json: async () => depoSecuritiesSample, status: 200 };
    }) as unknown as typeof fetch;

    await fetchNbuRegister(spyFetch, today);

    expect(sentUrl).toBe('https://bank.gov.ua/depo_securities?json');
  });

  it('maps a real DCP (domestic OVDP) record into BondTerms, keeping its payments', async () => {
    const result = await fetchNbuRegister(makeFetch([registerRow('UA4000239115')]), today);

    expect(result[0]).toEqual({
      isin: 'UA4000239115',
      currency: 'UAH',
      faceValueMinorUnits: 100_000,
      couponPct: 15.18,
      maturityDate: localMidnight(2027, 9, 15),
      couponFrequency: 'semiannually',
      name: 'Середньострокові UA4000239115',
      payments: [
        { date: localMidnight(2026, 9, 16), kind: 'coupon', amount: '75.9' },
        { date: localMidnight(2027, 3, 17), kind: 'coupon', amount: '75.9' },
        { date: localMidnight(2027, 9, 15), kind: 'coupon', amount: '75.9' },
        { date: localMidnight(2027, 9, 15), kind: 'redemption', amount: '1000' },
      ],
    });
  });

  it('maps a real OZDP (Eurobond) record, converting its fractional nominal 1 to 100 minor units', async () => {
    const result = await fetchNbuRegister(makeFetch(depoSecuritiesSample), today);
    const eurobond = result.find((bond) => bond.isin === 'XS2895055981');

    expect(eurobond).toEqual(
      expect.objectContaining({
        isin: 'XS2895055981',
        currency: 'USD',
        faceValueMinorUnits: 100,
        maturityDate: localMidnight(2029, 2, 1),
        couponFrequency: 'semiannually',
        name: 'OЗДП-середньострокова XS2895055981',
      }),
    );
    expect(eurobond?.payments?.at(0)).toEqual({
      date: localMidnight(2025, 2, 1),
      kind: 'coupon',
      amount: '0.00875',
    });
  });

  it('maps every record in the fixture (none silently dropped)', async () => {
    const result = await fetchNbuRegister(makeFetch(depoSecuritiesSample), today);

    expect(result).toHaveLength(depoSecuritiesSample.length);
  });

  it('drops a record whose currency the app does not model', async () => {
    const rows = [{ ...depoSecuritiesSample[0], val_code: 'XDR' }];

    const result = await fetchNbuRegister(makeFetch(rows), today);

    expect(result).toEqual([]);
  });

  it('drops a record with an unparseable maturity date', async () => {
    const rows = [{ ...depoSecuritiesSample[0], pgs_date: 'not-a-date' }];

    const result = await fetchNbuRegister(makeFetch(rows), today);

    expect(result).toEqual([]);
  });

  it('keeps a record but drops all its payments when one payment is malformed', async () => {
    const row = registerRow('UA4000239115');
    const rows = [
      {
        ...row,
        payments: [...row.payments, { pay_date: 'soon', pay_type: '1', pay_val: 75.9 }],
      },
    ];

    const result = await fetchNbuRegister(makeFetch(rows), today);

    expect(result[0].payments).toBeUndefined();
    expect(result[0].couponPct).toBe(15.18);
  });

  it('reads a numeric pay_type the same as its string form', async () => {
    const row = registerRow('UA4000239115');
    const rows = [
      {
        ...row,
        payments: row.payments.map((payment) => ({
          ...payment,
          pay_type: Number(payment.pay_type),
        })),
      },
    ];

    const result = await fetchNbuRegister(makeFetch(rows), today);

    expect(result[0].payments?.map((payment) => payment.kind)).toEqual([
      'coupon',
      'coupon',
      'coupon',
      'redemption',
    ]);
  });

  it('throws on a non-ok response', async () => {
    await expect(fetchNbuRegister(makeFetch({}, false), today)).rejects.toThrow('500');
  });
});

describe('fetchNbuRegister — coupon from the next unpaid coupon payment', () => {
  it('reads UA4000239115 as 75.90 x 2 / 1000 = 15.18%', async () => {
    expect(await couponOf([registerRow('UA4000239115')], today)).toBe(15.18);
  });

  it('treats a coupon paid today as paid and reads the next one', async () => {
    const row = {
      ...registerRow('UA4000239115'),
      payments: [
        { pay_date: '2026-09-26', pay_type: '1', pay_val: 80 },
        { pay_date: '2027-03-27', pay_type: '1', pay_val: 75.9 },
        { pay_date: '2027-03-27', pay_type: '2', pay_val: 1000 },
      ],
    };

    expect(await couponOf([row], today)).toBe(15.18);
  });

  // Shaped like UA4000226377 (an annual bond whose payment rate differs from
  // its auction rate): pay_period 364 is one payment a year.
  it('reads an annual bond from its payment (15.68%), not auk_proc (15.29%)', async () => {
    const annualRow = {
      cpcode: 'UA4000226377',
      nominal: 1000,
      auk_proc: 15.29,
      pgs_date: '2027-05-26',
      cpdescr: 'Середньострокові',
      pay_period: 364,
      val_code: 'UAH',
      payments: [
        { pay_date: '2026-05-27', pay_type: '1', pay_val: 156.8 },
        { pay_date: '2027-05-26', pay_type: '1', pay_val: 156.8 },
        { pay_date: '2027-05-26', pay_type: '2', pay_val: 1000 },
      ],
    };

    expect(await couponOf([annualRow], today)).toBe(15.68);
  });

  it('reads the step-up XS2895055981 as 4.5% before February 2027', async () => {
    expect(await couponOf([registerRow('XS2895055981')], today)).toBe(4.5);
  });

  it('reads the step-up XS2895055981 as 6% after August 2027', async () => {
    expect(await couponOf([registerRow('XS2895055981')], localMidnight(2027, 8, 15))).toBe(6);
  });

  it('computes the rate exactly, never as 15.400000000000002', async () => {
    const row = {
      ...registerRow('UA4000239115'),
      payments: [{ pay_date: '2027-03-17', pay_type: '1', pay_val: 77 }],
    };

    expect(await couponOf([row], today)).toBe(15.4);
  });

  it('falls back to auk_proc when no future coupon payment exists', async () => {
    expect(await couponOf([registerRow('UA4000234215')], today)).toBe(15.1);
  });

  it('falls back to auk_proc when the pay period maps to no frequency', async () => {
    const row = { ...registerRow('UA4000239115'), pay_period: 200 };

    expect(await couponOf([row], today)).toBe(15.18);
  });
});
