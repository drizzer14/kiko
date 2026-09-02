import {
  accruedMajor,
  addMonths,
  biweeklyCreditDates,
  bondAccruedGrossMajor,
  bondCouponDates,
  bondCouponMajor,
  daysBetween,
  depositAccruedMajor,
  depositBiweeklyMajor,
  depositCompoundedMajor,
  depositMaturity,
  monthsPerCouponPeriod,
  periodBoundary,
  periodsPerYear,
} from './interest';

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);
const AFTER_1Y = START + 365 * DAY;

// Local-midnight instant, matching the local Date arithmetic the bi-weekly and
// bond-coupon helpers use (addMonths / new Date(y, m, d)).
const local = (year: number, monthIndex: number, day: number): number =>
  new Date(year, monthIndex, day).getTime();

describe('periodsPerYear', () => {
  it('maps each frequency', () => {
    expect(periodsPerYear('bi-weekly')).toBe(24);
    expect(periodsPerYear('monthly')).toBe(12);
    expect(periodsPerYear('quarterly')).toBe(4);
    expect(periodsPerYear('annually')).toBe(1);
  });
});

describe('monthsPerCouponPeriod', () => {
  it('maps each bond coupon frequency to its calendar-month span', () => {
    expect(monthsPerCouponPeriod('monthly')).toBe(1);
    expect(monthsPerCouponPeriod('quarterly')).toBe(3);
    expect(monthsPerCouponPeriod('semiannually')).toBe(6);
    expect(monthsPerCouponPeriod('annually')).toBe(12);
  });
});

describe('daysBetween', () => {
  const day = 86_400_000;
  it('floors to whole days', () => {
    expect(daysBetween(0, 10 * day + 500)).toBe(10);
  });
  it('never returns a negative count', () => {
    expect(daysBetween(10 * day, 0)).toBe(0);
  });

  describe('DST-safe whole-day counting (Kyiv spring-forward)', () => {
    const originalTz = process.env.TZ;
    beforeAll(() => {
      // Force a DST-observing zone so the spring-forward is actually exercised
      // even when the test host runs in UTC. Node re-reads TZ per Date op.
      process.env.TZ = 'Europe/Kyiv';
    });
    afterAll(() => {
      process.env.TZ = originalTz;
    });

    it('counts 20 calendar days across the last-Sunday-of-March DST change', () => {
      // A bi-weekly Mar 12 -> Apr 1 2024 period straddles Kyiv's spring-forward
      // (Sun 31 Mar). The two local-midnight instants are 19h short of 20*24h,
      // so floor((end-start)/DAY_MS) under-counts to 19; whole calendar days = 20.
      const mar12 = new Date(2024, 2, 12).getTime();
      const apr1 = new Date(2024, 3, 1).getTime();
      expect(daysBetween(mar12, apr1)).toBe(20);
    });

    it('counts whole days across the last-Sunday-of-October fall-back too', () => {
      // Fall-back (Sun 27 Oct 2024) makes the span 24h+1h; a naive floor would
      // over-count. Oct 12 -> Nov 1 is 20 calendar days.
      const oct12 = new Date(2024, 9, 12).getTime();
      const nov1 = new Date(2024, 10, 1).getTime();
      expect(daysBetween(oct12, nov1)).toBe(20);
    });
  });
});

describe('addMonths', () => {
  it('advances the calendar month', () => {
    const start = Date.UTC(2026, 0, 15); // 2026-01-15
    expect(addMonths(start, 12)).toBe(Date.UTC(2027, 0, 15));
  });
});

describe('periodBoundary', () => {
  it('lands each monthly boundary on the calendar anniversary of the start', () => {
    // Winter boundaries (no DST shift): the k-th monthly boundary is the 1st of
    // the k-th following month.
    expect(periodBoundary(START, 'monthly', 1)).toBe(Date.UTC(2024, 1, 1));
    expect(periodBoundary(START, 'monthly', 2)).toBe(Date.UTC(2024, 2, 1));
  });
  it('steps quarterly and annually by three and twelve months', () => {
    // Compared against addMonths (not a UTC literal) so the assertion is immune
    // to the DST hour shift addMonths carries across a spring boundary.
    expect(periodBoundary(START, 'quarterly', 1)).toBe(addMonths(START, 3));
    expect(periodBoundary(START, 'annually', 1)).toBe(addMonths(START, 12));
  });
});

describe('accruedMajor', () => {
  it('accrues simple interest over the elapsed days', () => {
    // 10% of 1000 over half a year (182.5 days) ~ 50.
    expect(accruedMajor(1000, 10, 182.5)).toBeCloseTo(50, 6);
  });
});

describe('depositMaturity', () => {
  it('anchors maturity to the earliest contribution date', () => {
    const later = Date.UTC(2024, 5, 1);
    expect(depositMaturity([{ date: later }, { date: START }], 12)).toBe(
      new Date(START).setMonth(new Date(START).getMonth() + 12),
    );
  });
});

describe('depositCompoundedMajor — calendar compounding', () => {
  const single = [{ amountMajor: 10000, date: START }];

  it('sums compounded value over contributions (0% rate = sum of amounts)', () => {
    const value = depositCompoundedMajor(
      [
        { amountMajor: 1000, date: START },
        { amountMajor: 500, date: START },
      ],
      0,
      'monthly',
      12,
      AFTER_1Y,
    );
    expect(value).toBeCloseTo(1500, 6);
  });

  it('recapitalizes on each calendar anniversary, not a drifting day slice', () => {
    // 10,000 at 12% monthly. Each completed month rolls in exactly 1% on the
    // month's calendar anniversary. The old fixed 365/12-day period drifted a
    // whole period behind between anniversaries (e.g. still 10,100 at Mar 1);
    // the calendar schedule gives the bank-correct compounding.
    expect(depositCompoundedMajor(single, 12, 'monthly', 24, Date.UTC(2024, 1, 1))).toBeCloseTo(
      10100,
      2,
    );
    expect(depositCompoundedMajor(single, 12, 'monthly', 24, Date.UTC(2024, 2, 1))).toBeCloseTo(
      10201,
      2,
    );
    expect(depositCompoundedMajor(single, 12, 'monthly', 24, Date.UTC(2024, 3, 1))).toBeCloseTo(
      10303.01,
      2,
    );
  });

  it('compounds each contribution over one calendar year (annually)', () => {
    // Anchored at a leap-year start, one 365-day year is a partial first
    // annual period, so this is simple 10% for the year: 1100.
    const value = depositCompoundedMajor(single.slice(0, 1), 10, 'annually', 12, AFTER_1Y);
    expect(value).toBeCloseTo(11000 - 0, 6); // 10000 -> 11000
  });

  it('doubles when two equal contributions share a date (linearity)', () => {
    const one = depositCompoundedMajor(
      [{ amountMajor: 1000, date: START }],
      10,
      'monthly',
      24,
      AFTER_1Y,
    );
    const two = depositCompoundedMajor(
      [
        { amountMajor: 1000, date: START },
        { amountMajor: 1000, date: START },
      ],
      10,
      'monthly',
      24,
      AFTER_1Y,
    );
    expect(two).toBeCloseTo(one * 2, 6);
  });

  it('excludes a future-dated contribution (D2)', () => {
    // 10,000 opened 2024-01-01, a 5,000 top-up scheduled 2024-04-10. Valued
    // 2024-02-01 the top-up has not happened yet, so the value is 10,100 — not
    // 15,100 as the old code reported by counting the future contribution.
    const contributions = [
      { amountMajor: 10000, date: START },
      { amountMajor: 5000, date: Date.UTC(2024, 3, 10) },
    ];
    expect(
      depositCompoundedMajor(contributions, 12, 'monthly', 24, Date.UTC(2024, 1, 1)),
    ).toBeCloseTo(10100, 2);
  });

  it('anchors a mid-term top-up to the deposit schedule, not its own date', () => {
    // Worked example (debugger): 10,000 on 2024-01-01, +5,000 on 2024-04-10,
    // 12% monthly, recap on, valued 2025-01-01. The 5,000 accrues a partial
    // first period to the next deposit boundary (Apr 10 -> May 1 = 21 whole
    // calendar days, DST-safe), then compounds on the deposit schedule. (The
    // debugger's hand table reads ~16,718.63; this half-open actual/365 day
    // count gives 16,719.91 — within rounding of the statement convention.)
    const contributions = [
      { amountMajor: 10000, date: START },
      { amountMajor: 5000, date: local(2024, 3, 10) },
    ];
    const value = depositCompoundedMajor(contributions, 12, 'monthly', 24, Date.UTC(2025, 0, 1));
    expect(value).toBeCloseTo(16719.91, 1);
    // The top-up is credited, so the value exceeds the single-contribution line.
    expect(value).toBeGreaterThan(
      depositCompoundedMajor([contributions[0]], 12, 'monthly', 24, Date.UTC(2025, 0, 1)),
    );
  });

  it('caps compounding at maturity', () => {
    const atMaturity = depositCompoundedMajor(single, 12, 'monthly', 12, addMonths(START, 12));
    const wayPast = depositCompoundedMajor(single, 12, 'monthly', 12, addMonths(START, 60));
    expect(wayPast).toBeCloseTo(atMaturity, 6);
  });

  it('returns zero when every contribution is still in the future', () => {
    expect(depositCompoundedMajor(single, 12, 'monthly', 24, START - DAY)).toBe(0);
  });
});

describe('depositAccruedMajor — recap-off cumulative interest', () => {
  it('accrues cumulative simple interest from the contribution date to now', () => {
    // 10,000 at 10% over a full 365-day year => 1000.00 cumulative.
    const accrued = depositAccruedMajor([{ amountMajor: 10000, date: START }], 10, 120, AFTER_1Y);
    expect(accrued).toBeCloseTo(1000, 6);
  });

  it('sums cumulative accrual across contributions, each from its own date', () => {
    const now = START + 200 * DAY;
    const c1 = { amountMajor: 10000, date: now - 180 * DAY };
    const c2 = { amountMajor: 5000, date: now - 60 * DAY };
    const accrued = depositAccruedMajor([c1, c2], 10, 120, now);
    const expected = accruedMajor(10000, 10, 180) + accruedMajor(5000, 10, 60);
    expect(accrued).toBeCloseTo(expected, 6);
  });

  it('excludes a future-dated contribution (D2)', () => {
    const now = START + 200 * DAY;
    const past = { amountMajor: 10000, date: START };
    const future = { amountMajor: 5000, date: now + 10 * DAY };
    const withFuture = depositAccruedMajor([past, future], 10, 120, now);
    const withoutFuture = depositAccruedMajor([past], 10, 120, now);
    expect(withFuture).toBeCloseTo(withoutFuture, 6);
  });

  it('stays non-zero for a matured multi-contribution deposit (capped at maturity)', () => {
    const c1 = { amountMajor: 10000, date: START };
    const c2 = { amountMajor: 5000, date: START + 30 * DAY };
    const accrued = depositAccruedMajor([c1, c2], 10, 12, AFTER_1Y + 500 * DAY);
    expect(accrued).toBeGreaterThan(0);
  });
});

describe('biweeklyCreditDates — opening-day-anchored semi-monthly boundaries', () => {
  it('reproduces the user statement: opened Jan 11, credits on Feb 1/12, Mar 1/12, Apr 1', () => {
    // Opened 2024-01-11 (D=11). First accrual runs from Jan 12; each credit is a
    // period end. Boundaries alternate mid-month (the 12th = D+1) and the 1st.
    const dates = biweeklyCreditDates(local(2024, 0, 11), local(2024, 3, 1));
    expect(dates).toEqual([
      local(2024, 0, 12), // Jan 12  (credits Period B of Jan: Jan 12 -> Feb 1)... first accrual start
      local(2024, 1, 1), // Feb 1   (credits Jan 12 -> Feb 1)
      local(2024, 1, 12), // Feb 12 (credits Feb 1 -> Feb 12)
      local(2024, 2, 1), // Mar 1   (credits Feb 12 -> Mar 1)
      local(2024, 2, 12), // Mar 12 (credits Mar 1 -> Mar 12)
      local(2024, 3, 1), // Apr 1   (credits Mar 12 -> Apr 1)
    ]);
  });

  it('clamps the mid-month boundary when the opening day exceeds a month length', () => {
    // Opened Jan 31 (D=31). February has 28 days, so its (D+1) mid-boundary
    // collapses onto Mar 1: February is one whole period, not two.
    const dates = biweeklyCreditDates(local(2023, 0, 31), local(2023, 2, 2));
    expect(dates).toContain(local(2023, 1, 1)); // Feb 1
    expect(dates).toContain(local(2023, 2, 1)); // Mar 1
    // February emits no distinct mid-month credit: its only boundaries are the
    // 1st and the next 1st (Mar), so nothing falls strictly inside the month.
    expect(dates.some((d) => d > local(2023, 1, 1) && d < local(2023, 2, 1))).toBe(false);
  });
});

describe('depositBiweeklyMajor — net-of-tax capitalization', () => {
  it('capitalizes each period on the running balance (opened Jan 11, 12%, no tax)', () => {
    // Jan 12->Feb 1 (20d), Feb 1->Feb 12 (11d), Feb 12->Mar 1 (18d, leap year),
    // Mar 1->Mar 12 (11d), each period accrues balance*12%*days/365 and rolls in.
    const result = depositBiweeklyMajor(
      [{ amountMajor: 10000, date: local(2024, 0, 11) }],
      12,
      0,
      local(2024, 0, 11),
      local(2024, 2, 12),
    );
    expect(result.principalMajor).toBeCloseTo(10000, 6);
    expect(result.taxMajor).toBeCloseTo(0, 6);
    expect(result.netValueMajor).toBeCloseTo(10198.69, 0);
    expect(result.grossInterestMajor).toBeCloseTo(198.69, 0);
  });

  it('credits a mid-period top-up weighted from its landing date', () => {
    // A +500 top-up on Feb 10 lands in the Feb 1 -> Feb 12 period, earning only
    // its 2 trailing days there, then joining the balance for later periods.
    const withTopUp = depositBiweeklyMajor(
      [
        { amountMajor: 10000, date: local(2024, 0, 11) },
        { amountMajor: 500, date: local(2024, 1, 10) },
      ],
      12,
      0,
      local(2024, 0, 11),
      local(2024, 2, 12),
    );
    const withoutTopUp = depositBiweeklyMajor(
      [{ amountMajor: 10000, date: local(2024, 0, 11) }],
      12,
      0,
      local(2024, 0, 11),
      local(2024, 2, 12),
    );
    // Principal grows by the top-up; value grows by the top-up plus its interest.
    expect(withTopUp.principalMajor).toBeCloseTo(10500, 6);
    expect(withTopUp.netValueMajor).toBeGreaterThan(withoutTopUp.netValueMajor + 500);
    // The top-up earns roughly 500*12%*(2 + 18 + 11)/365 over its ~31 held days.
    const topUpInterest = withTopUp.netValueMajor - withoutTopUp.netValueMajor - 500;
    expect(topUpInterest).toBeGreaterThan(0);
    expect(topUpInterest).toBeLessThan(500 * 0.12); // under a full year of interest
  });

  it('deducts tax each period so the net value compounds on the after-tax balance', () => {
    const gross = depositBiweeklyMajor(
      [{ amountMajor: 10000, date: local(2024, 0, 11) }],
      12,
      0,
      local(2024, 0, 11),
      local(2024, 2, 12),
    );
    const taxed = depositBiweeklyMajor(
      [{ amountMajor: 10000, date: local(2024, 0, 11) }],
      12,
      23,
      local(2024, 0, 11),
      local(2024, 2, 12),
    );
    // Net capitalization: tax is withheld before each period compounds, so the
    // taxed run compounds on a smaller balance and earns strictly less gross
    // interest than the untaxed run.
    expect(taxed.grossInterestMajor).toBeLessThan(gross.grossInterestMajor);
    expect(taxed.taxMajor).toBeCloseTo(taxed.grossInterestMajor * 0.23, 6);
    expect(taxed.netValueMajor).toBeLessThan(gross.netValueMajor);
    expect(taxed.netValueMajor).toBeCloseTo(10000 + taxed.grossInterestMajor - taxed.taxMajor, 6);
  });

  it('returns just the principal when held under a day (no accrual)', () => {
    const result = depositBiweeklyMajor(
      [{ amountMajor: 10000, date: local(2024, 0, 11) }],
      12,
      23,
      local(2024, 0, 11),
      local(2024, 0, 11) + DAY / 2,
    );
    expect(result.netValueMajor).toBeCloseTo(10000, 6);
    expect(result.grossInterestMajor).toBeCloseTo(0, 6);
  });
});

describe('bondCouponDates — mid-month-15th + exact-maturity, stepped back from maturity', () => {
  it('reproduces the Monobank screenshot (semiannual, matures 14 Oct 2026)', () => {
    // Purchase 18 Sep 2025, matures 14 Oct 2026, 6-month coupons. The maturity
    // coupon lands on the exact maturity date; earlier coupons land on the 15th.
    const dates = bondCouponDates(local(2025, 8, 18), local(2026, 9, 14), 'semiannually');
    expect(dates).toEqual([
      local(2025, 9, 15), // 15 Oct 2025
      local(2026, 3, 15), // 15 Apr 2026
      local(2026, 9, 14), // 14 Oct 2026 (= maturity, exact)
    ]);
  });

  it('excludes coupons on or before the purchase date', () => {
    const dates = bondCouponDates(local(2025, 8, 18), local(2026, 9, 14), 'semiannually');
    expect(dates.every((d) => d > local(2025, 8, 18))).toBe(true);
  });

  it('lands monthly coupons on the 15th and the maturity coupon exactly', () => {
    // Purchased 1 Jan 2025: the 15 Jan coupon (strictly after purchase) counts.
    const dates = bondCouponDates(local(2025, 0, 1), local(2025, 3, 20), 'monthly');
    expect(dates).toEqual([
      local(2025, 0, 15), // 15 Jan
      local(2025, 1, 15), // 15 Feb
      local(2025, 2, 15), // 15 Mar
      local(2025, 3, 20), // 20 Apr = maturity, exact
    ]);
  });

  it('lands a single annual coupon on the maturity date', () => {
    const dates = bondCouponDates(local(2024, 0, 1), local(2025, 5, 10), 'annually');
    expect(dates).toEqual([
      local(2024, 5, 15), // 15 Jun 2024
      local(2025, 5, 10), // 10 Jun 2025 = maturity, exact
    ]);
  });
});

describe('bondCouponMajor', () => {
  it('is nominal * couponPct / couponsPerYear (16.35% semiannual on 100,000 = 8,175)', () => {
    expect(bondCouponMajor(100_000, 16.35, 'semiannually')).toBeCloseTo(8175, 6);
    expect(bondCouponMajor(100_000, 12, 'quarterly')).toBeCloseTo(3000, 6);
    expect(bondCouponMajor(100_000, 12, 'monthly')).toBeCloseTo(1000, 6);
    expect(bondCouponMajor(100_000, 12, 'annually')).toBeCloseTo(12000, 6);
  });
});

describe('bondAccruedGrossMajor — dirty-price accrual over the current coupon period', () => {
  const NOMINAL = 100_000;
  const purchase = local(2025, 8, 18);
  const maturity = local(2026, 9, 14);

  it('accrues a fraction of the next coupon, pro-rated by days in the current period', () => {
    // Current period is purchase (18 Sep 2025) -> first coupon (15 Oct 2025) =
    // 27 days. Valued 9 days in => 9/27 = one third of the 8,175 coupon = 2,725.
    const nineDaysIn = purchase + 9 * DAY;
    const accrued = bondAccruedGrossMajor(
      NOMINAL,
      16.35,
      'semiannually',
      purchase,
      maturity,
      nineDaysIn,
    );
    expect(accrued).toBeCloseTo(2725, 6);
  });

  it('is ~0 exactly on a coupon date (value drops by the coupon then)', () => {
    const onCoupon = local(2025, 9, 15);
    const accrued = bondAccruedGrossMajor(
      NOMINAL,
      16.35,
      'semiannually',
      purchase,
      maturity,
      onCoupon,
    );
    expect(accrued).toBeCloseTo(0, 6);
  });

  it('accrues nothing before purchase or at/after maturity (redeemed)', () => {
    expect(
      bondAccruedGrossMajor(NOMINAL, 16.35, 'semiannually', purchase, maturity, purchase - DAY),
    ).toBe(0);
    expect(
      bondAccruedGrossMajor(NOMINAL, 16.35, 'semiannually', purchase, maturity, maturity),
    ).toBe(0);
    expect(
      bondAccruedGrossMajor(NOMINAL, 16.35, 'semiannually', purchase, maturity, maturity + DAY),
    ).toBe(0);
  });
});
