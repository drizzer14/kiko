import {
  accruedMajor,
  addMonths,
  biweeklyCreditDates,
  bondCouponDates,
  bondCouponMajor,
  daysBetween,
  depositAccruedMajor,
  depositLedger,
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

describe('addMonths month-end clamping', () => {
  it('clamps 31 Jan + 1 month to 28 Feb, not 3 Mar', () => {
    expect(addMonths(local(2026, 0, 31), 1)).toBe(local(2026, 1, 28));
  });

  it('clamps 31 Aug + 6 months to 28 Feb, not 3 Mar', () => {
    expect(addMonths(local(2025, 7, 31), 6)).toBe(local(2026, 1, 28));
  });

  it('clamps a backwards step the same way', () => {
    expect(addMonths(local(2026, 2, 31), -1)).toBe(local(2026, 1, 28));
  });

  it('leaves a day that fits the target month untouched', () => {
    expect(addMonths(local(2026, 0, 15), 1)).toBe(local(2026, 1, 15));
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

describe('periodBoundary month-end', () => {
  it('walks month-ends without skipping February', () => {
    const start = local(2026, 0, 31);

    expect(periodBoundary(start, 'monthly', 1)).toBe(local(2026, 1, 28));
    expect(periodBoundary(start, 'monthly', 2)).toBe(local(2026, 2, 31));
    expect(periodBoundary(start, 'monthly', 3)).toBe(local(2026, 3, 30));
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

describe('depositMaturity month-end', () => {
  it('matures a 31 Aug 2025 six-month deposit on 28 Feb 2026', () => {
    expect(depositMaturity([{ date: local(2025, 7, 31) }], 6)).toBe(local(2026, 1, 28));
  });
});

describe('depositLedger — step-by-step engine, verified against the real statement', () => {
  // The user's real monobank deposit: opened 11 Jan 2026 with 100,000.00 at 16%
  // annual, bi-weekly (default) recapitalization, 12-month term, with top-ups of
  // +50,000.00 (10 Feb), +50,000.00 (25 Jul) and +30,000.00 (21 Aug). The oracle
  // (scratchpad/deposit-model-from-statement.md) gives the capitalized balances
  // and the current value to the kopeck.
  const oracleContributions = [
    { amountMinor: 100_000_00, date: local(2026, 0, 11) },
    { amountMinor: 50_000_00, date: local(2026, 1, 10) },
    { amountMinor: 50_000_00, date: local(2026, 6, 25) },
    { amountMinor: 30_000_00, date: local(2026, 7, 21) },
  ];
  // A `now` between the 1 Sep accrual and the 12 Sep capitalization: the 1 Sep
  // interest is accrued but NOT yet capitalized, so it is excluded from value.
  const NOW = local(2026, 8, 2);
  const ledger = depositLedger(oracleContributions, 16, 'bi-weekly', 12, NOW);

  const capBalances = ledger.accruals.filter((a) => a.capitalized).map((a) => a.balanceAfterMinor);

  it('reproduces the current deposit value exactly (240,814.16)', () => {
    expect(ledger.currentValueMinor).toBe(240_814_16);
    // Value = principal landed by now + net capitalized interest.
    expect(ledger.principalMinor).toBe(230_000_00);
  });

  it('reproduces every capitalized balance EXACTLY (cumulative-basis withholding)', () => {
    // The oracle's seven capitalized balances (through the 12 Aug cap). The bank
    // withholds each levy on a running CUMULATIVE basis (round(cumGross*rate)
    // minus what was already withheld), so every line lands to the kopeck — there
    // is no ±1 drift to converge away. All seven balances are exact.
    const oracle = [
      151_063_23, 152_490_56, 154_085_69, 155_645_41, 157_273_49, 158_865_50, 210_814_16,
    ];
    expect(capBalances.slice(0, oracle.length)).toEqual(oracle);
  });

  it('reproduces every accrual line (gross, 18% income, 5% military) to the kopeck', () => {
    // The full statement oracle: for each of the 15 accrual events through 31 Aug,
    // [grossMinor, incomeTaxMinor, militaryLevyMinor]. These are the exact bank
    // lines — the cumulative-basis withholding is what reconciles the two military
    // lines a naive per-period round would miss (12 Feb 25.20 not 25.21; 12 Mar
    // 36.43 not 36.42) plus the income lines that likewise drift (e.g. 12 Jul
    // 136.51, 1 Aug 274.24, 12 Aug 181.29).
    const oracle: [number, number, number][] = [
      [87_671, 15_781, 4_384], // [12.01-31.01] credited 1 Feb
      [50_411, 9_074, 2_520], // [01.02-11.02] credited 12 Feb (cap)
      [112_527, 20_255, 5_626], // [12.02-28.02] credited 1 Mar
      [72_841, 13_111, 3_643], // [01.03-11.03] credited 12 Mar (cap)
      [133_628, 24_053, 6_681], // [12.03-31.03] credited 1 Apr
      [73_530, 13_235, 3_676], // [01.04-11.04] credited 12 Apr (cap)
      [128_264, 23_088, 6_414], // [12.04-30.04] credited 1 May
      [74_299, 13_374, 3_715], // [01.05-11.05] credited 12 May (cap)
      [136_388, 24_550, 6_819], // [12.05-31.05] credited 1 Jun
      [75_051, 13_509, 3_753], // [01.06-11.06] credited 12 Jun (cap)
      [130_918, 23_565, 6_545], // [12.06-30.06] credited 1 Jul
      [75_836, 13_651, 3_792], // [01.07-11.07] credited 12 Jul (cap)
      [152_360, 27_424, 7_618], // [12.07-31.07] credited 1 Aug
      [100_713, 18_129, 5_036], // [01.08-11.08] credited 12 Aug (cap)
      [197_889, 35_620, 9_894], // [12.08-31.08] credited 1 Sep
    ];
    const lines = ledger.accruals
      .slice(0, oracle.length)
      .map((a) => [a.grossMinor, a.incomeTaxMinor, a.militaryLevyMinor]);
    expect(lines).toEqual(oracle);
  });

  it('accrues on the last capitalized balance, capitalizing once a month', () => {
    // First accrual [12.01-31.01] on 100,000.00 for 20 days: gross 876.71.
    const first = ledger.accruals[0];
    expect(first.grossMinor).toBe(87_671);
    expect(first.incomeTaxMinor).toBe(15_781); // round(18% of 876.71)
    expect(first.militaryLevyMinor).toBe(4_384); // round(5% of 876.71)
    expect(first.capitalized).toBe(false); // the 1 Feb accrual is not capitalized
    // The 12 Feb accrual [01.02-11.02] capitalizes both February periods.
    const feb12 = ledger.accruals[1];
    expect(feb12.capitalized).toBe(true);
    expect(feb12.date).toBe(local(2026, 1, 12));
  });

  it('excludes the in-progress (uncapitalized) accrual from the value', () => {
    // The 1 Sep accrual exists in the ledger but its capitalization (12 Sep) is
    // after `now`, so it is not in the current value.
    const sep1 = ledger.accruals.find((a) => a.date === local(2026, 8, 1));
    expect(sep1).toBeDefined();
    expect(ledger.currentValueMinor).toBe(240_814_16); // unchanged by the pending accrual
  });

  it('breakdown reconciles: value = principal + capitalized gross - capitalized tax', () => {
    expect(ledger.principalMinor + ledger.capitalizedGrossMinor - ledger.capitalizedTaxMinor).toBe(
      ledger.currentValueMinor,
    );
  });

  it('iterates the calendar frequencies step-by-step too (no closed form)', () => {
    // 100,000.00 at 12% monthly recap, one completed month capitalizes net of
    // tax: gross 12%/12 = 1% of 100,000 for ~31 days actual/365. The value is
    // strictly the principal plus net-of-tax capitalized interest.
    const monthly = depositLedger(
      [{ amountMinor: 100_000_00, date: local(2026, 0, 1) }],
      12,
      'monthly',
      24,
      local(2026, 2, 1),
    );
    // Two monthly caps (1 Feb, 1 Mar). Value exceeds principal but by less than
    // the untaxed 2% (tax withheld each period).
    expect(monthly.currentValueMinor).toBeGreaterThan(100_000_00);
    expect(monthly.currentValueMinor).toBeLessThan(102_000_00);
    expect(monthly.capitalizedTaxMinor).toBeGreaterThan(0);
  });

  it('returns just the principal when no period has completed yet', () => {
    const fresh = depositLedger(
      [{ amountMinor: 100_000_00, date: local(2026, 0, 11) }],
      16,
      'bi-weekly',
      12,
      local(2026, 0, 11),
    );
    expect(fresh.currentValueMinor).toBe(100_000_00);
    expect(fresh.capitalizedGrossMinor).toBe(0);
  });

  it('excludes a future-dated contribution from principal and value', () => {
    const withFuture = depositLedger(
      [
        { amountMinor: 100_000_00, date: local(2026, 0, 11) },
        { amountMinor: 50_000_00, date: local(2026, 6, 25) },
      ],
      16,
      'bi-weekly',
      12,
      local(2026, 2, 1), // before the July top-up
    );
    expect(withFuture.principalMinor).toBe(100_000_00);
  });
});

describe('depositAccruedMajor — recap-off cumulative interest', () => {
  it('accrues cumulative simple interest from the day AFTER the contribution to now', () => {
    // BUG2: interest accrues from the day AFTER the contribution lands (the
    // day-after convention shared with the statement-validated recap-ON engine
    // `depositLedger`), NOT from the contribution date itself. So a 10,000
    // deposit at 10% over a 365-day span earns 364 days, not 365:
    //   10,000 * 10% * 364/365 = 997.2602...
    const accrued = depositAccruedMajor([{ amountMajor: 10000, date: START }], 10, 120, AFTER_1Y);
    expect(accrued).toBeCloseTo((10000 * 0.1 * 364) / 365, 6);
  });

  // BUG2 regression: recap-OFF used to accrue from the contribution DATE itself,
  // one day more than the statement-validated recap-ON engine (`depositLedger`
  // earns each tranche from `dayAfter` it lands). Pin that the two conventions
  // now AGREE on the first-period accrual: a single 10,000 deposit at 10% over
  // the first full year (now = maturity), annual compounding. Compared against
  // recap-ON's pre-tax gross for that period. Before the fix recap-OFF counted
  // 366 days (leap year) vs recap-ON's 365, diverging by a day's interest.
  it("agrees with the recap-ON engine's first-period accrual (day-after convention)", () => {
    const rate = 10;
    const contributionMajor = 10000;
    const maturity = addMonths(START, 12);

    const recapOff = depositAccruedMajor(
      [{ amountMajor: contributionMajor, date: START }],
      rate,
      12,
      maturity,
    );
    const { accruals } = depositLedger(
      [{ amountMinor: contributionMajor * 100, date: START }],
      rate,
      'annually',
      12,
      maturity,
    );
    const recapOnFirstPeriodMajor = accruals[0].grossMinor / 100;

    expect(recapOff).toBeCloseTo(recapOnFirstPeriodMajor, 2);
  });

  it('sums cumulative accrual across contributions, each from the day after its own date', () => {
    const now = START + 200 * DAY;
    const c1 = { amountMajor: 10000, date: now - 180 * DAY };
    const c2 = { amountMajor: 5000, date: now - 60 * DAY };
    const accrued = depositAccruedMajor([c1, c2], 10, 120, now);
    // BUG2 day-after convention: each contribution earns from the day AFTER it
    // lands, so a 180-day-old tranche accrues 179 days and a 60-day-old one 59.
    const expected = accruedMajor(10000, 10, 179) + accruedMajor(5000, 10, 59);
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

describe('bondCouponDates month-end maturity', () => {
  it('pays three semiannual coupons for a 31 Oct 2026 maturity bought 1 May 2025', () => {
    expect(bondCouponDates(local(2025, 4, 1), local(2026, 9, 31), 'semiannually')).toEqual([
      local(2025, 9, 15),
      local(2026, 3, 15),
      local(2026, 9, 31),
    ]);
  });

  it('emits no duplicate instants for a monthly month-end maturity', () => {
    const dates = bondCouponDates(local(2025, 11, 1), local(2026, 2, 31), 'monthly');

    expect(new Set(dates).size).toBe(dates.length);
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
