import {
  currentQuota,
  markUsedUp,
  type QuoteQuota,
  refreshAllowance,
  reserve,
  withUserLimits,
} from './quote-quota';

const DAY_MS = 24 * 60 * 60 * 1000;
const OCTOBER_1 = Date.UTC(2026, 9, 1);
const LATE_OCTOBER_1 = OCTOBER_1 + 23 * 60 * 60 * 1000;

const quota = (overrides: Partial<QuoteQuota> = {}): QuoteQuota => ({
  day: OCTOBER_1,
  calls: 5,
  dailyLimit: 20,
  symbols: ['AAPL.US'],
  ...overrides,
});

describe('currentQuota', () => {
  it('starts a day with no stored quota at zero calls under the free limit of 20', () => {
    expect(currentQuota(null, LATE_OCTOBER_1)).toEqual({
      day: OCTOBER_1,
      calls: 0,
      dailyLimit: 20,
      symbols: [],
    });
  });

  it('keeps a quota stored earlier the same UTC day', () => {
    expect(currentQuota(quota(), LATE_OCTOBER_1)).toEqual(quota());
  });

  it('starts over at midnight UTC, keeping the daily limit', () => {
    expect(currentQuota(quota({ dailyLimit: 100 }), OCTOBER_1 + DAY_MS)).toEqual({
      day: OCTOBER_1 + DAY_MS,
      calls: 0,
      dailyLimit: 100,
      symbols: [],
    });
  });
});

describe('refreshAllowance', () => {
  it('leaves the last 2 calls of the day for search', () => {
    expect(refreshAllowance(quota({ calls: 5 }))).toBe(13);
  });

  it('is zero once only the 2 search calls are left', () => {
    expect(refreshAllowance(quota({ calls: 18 }))).toBe(0);
  });

  it('never goes below zero', () => {
    expect(refreshAllowance(quota({ calls: 25 }))).toBe(0);
  });
});

describe('reserve', () => {
  it('adds the calls and the requested symbols', () => {
    expect(reserve(quota(), 2, ['VOD.LSE', 'SAP.XETRA'])).toEqual(
      quota({ calls: 7, symbols: ['AAPL.US', 'VOD.LSE', 'SAP.XETRA'] }),
    );
  });
});

describe('markUsedUp', () => {
  it('counts every call of the day as spent', () => {
    expect(markUsedUp(quota({ calls: 4 }))).toEqual(quota({ calls: 20 }));
  });

  it('keeps a count already past the limit', () => {
    expect(markUsedUp(quota({ calls: 22 }))).toEqual(quota({ calls: 22 }));
  });
});

describe('withUserLimits', () => {
  it("takes EODHD's own count and limit for the same UTC day", () => {
    expect(
      withUserLimits(
        quota({ calls: 3 }),
        { dailyLimit: 100, requestsToday: 9, requestsDay: OCTOBER_1 },
        LATE_OCTOBER_1,
      ),
    ).toEqual(quota({ calls: 9, dailyLimit: 100 }));
  });

  it("takes only the limit when EODHD's day is not today's UTC day", () => {
    expect(
      withUserLimits(
        quota({ calls: 3 }),
        { dailyLimit: 100, requestsToday: 9, requestsDay: OCTOBER_1 - DAY_MS },
        LATE_OCTOBER_1,
      ),
    ).toEqual(quota({ calls: 3, dailyLimit: 100 }));
  });

  it('starts a stale stored quota over before it takes the count', () => {
    expect(
      withUserLimits(
        quota({ day: OCTOBER_1 - DAY_MS, calls: 3 }),
        { dailyLimit: 20, requestsToday: 1, requestsDay: OCTOBER_1 },
        LATE_OCTOBER_1,
      ),
    ).toEqual({ day: OCTOBER_1, calls: 1, dailyLimit: 20, symbols: [] });
  });
});
