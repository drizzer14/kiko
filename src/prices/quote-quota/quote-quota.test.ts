import {
  settle,
  reserve,
  markUsedUp,
  isBackedOff,
  currentQuota,
  withoutRejection,
  isBackfillBackedOff,
  withSavedKey,
  quotaResetsAt,
  withUserLimits,
  type QuoteQuota,
  withRestoredKey,
  refreshAllowance,
  withRestoredPrices,
  withUnconfirmedLimit,
  type QuotaSettlement,
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

  it('keeps a daily limit EODHD has not confirmed unconfirmed on the next day', () => {
    expect(currentQuota(quota({ isLimitUnconfirmed: true }), OCTOBER_1 + DAY_MS)).toMatchObject({
      isLimitUnconfirmed: true,
    });
  });

  it('keeps the key state and every symbol back-off and backfill on the next day', () => {
    const keyState: Partial<QuoteQuota> = {
      isKeyRejected: true,
      keyGeneration: 3,
      backoff: { 'DEAD.US': { strikes: 1, retryDay: OCTOBER_1 + 2 * DAY_MS, lastLotDay: 0 } },
      backfilledFrom: { 'AAPL.US': OCTOBER_1 - 100 * DAY_MS },
    };

    expect(currentQuota(quota(keyState), OCTOBER_1 + DAY_MS)).toEqual({
      day: OCTOBER_1 + DAY_MS,
      calls: 0,
      dailyLimit: 20,
      symbols: [],
      ...keyState,
    });
  });
});

describe('reserve', () => {
  it('lists a symbol already requested today once', () => {
    expect(reserve(quota(), 1, ['AAPL.US']).symbols).toEqual(['AAPL.US']);
  });
});

describe('isBackedOff', () => {
  const backedOff = quota({
    backoff: { 'DEAD.US': { strikes: 2, retryDay: OCTOBER_1 + DAY_MS, lastLotDay: 500 } },
  });

  it('holds a symbol back before its retry day', () => {
    expect(isBackedOff(backedOff, 'DEAD.US', 500)).toBe(true);
  });

  it('lets the symbol go on its retry day', () => {
    expect(isBackedOff({ ...backedOff, day: OCTOBER_1 + DAY_MS }, 'DEAD.US', 500)).toBe(false);
  });

  it('lets the symbol go once its lots changed', () => {
    expect(isBackedOff(backedOff, 'DEAD.US', 600)).toBe(false);
  });

  it('never holds back a symbol with no back-off', () => {
    expect(isBackedOff(backedOff, 'AAPL.US', 500)).toBe(false);
  });
});

describe('isBackfillBackedOff', () => {
  const backedOff = quota({
    backoff: {
      'DEAD.US': { strikes: 2, retryDay: OCTOBER_1 + DAY_MS, lastLotDay: 500, firstLotDay: 100 },
    },
  });

  it('holds the older history back before the retry day', () => {
    expect(isBackfillBackedOff(backedOff, 'DEAD.US', 100)).toBe(true);
  });

  it('lets the older history go on the retry day', () => {
    expect(isBackfillBackedOff({ ...backedOff, day: OCTOBER_1 + DAY_MS }, 'DEAD.US', 100)).toBe(
      false,
    );
  });

  it('lets the history of an even older lot go', () => {
    expect(isBackfillBackedOff(backedOff, 'DEAD.US', 50)).toBe(false);
  });

  it('lets the history go for a back-off stored without its first lot', () => {
    const stored = quota({
      backoff: { 'DEAD.US': { strikes: 2, retryDay: OCTOBER_1 + DAY_MS, lastLotDay: 500 } },
    });

    expect(isBackfillBackedOff(stored, 'DEAD.US', 100)).toBe(false);
  });
});

describe('quotaResetsAt', () => {
  it("is the next midnight UTC, EODHD's reset", () => {
    expect(quotaResetsAt(LATE_OCTOBER_1)).toBe(OCTOBER_1 + DAY_MS);
    expect(quotaResetsAt(OCTOBER_1)).toBe(OCTOBER_1 + DAY_MS);
  });
});

describe('withSavedKey', () => {
  const previousKey = quota({
    calls: 20,
    symbols: ['AAPL.US'],
    keyGeneration: 4,
    isKeyRejected: true,
    backoff: { 'DEAD.US': { strikes: 1, retryDay: OCTOBER_1 + 2 * DAY_MS, lastLotDay: 0 } },
    backfilledFrom: { 'AAPL.US': OCTOBER_1 - 100 * DAY_MS },
  });

  it("starts the day over for a key EODHD reports no request today for, keeping the series' backfill", () => {
    expect(
      withSavedKey(
        previousKey,
        { dailyLimit: 100, requestsToday: 9, requestsDay: OCTOBER_1 - DAY_MS },
        LATE_OCTOBER_1,
      ),
    ).toEqual({
      day: OCTOBER_1,
      calls: 0,
      dailyLimit: 100,
      symbols: [],
      keyGeneration: 5,
      backfilledFrom: { 'AAPL.US': OCTOBER_1 - 100 * DAY_MS },
    });
  });

  it("takes EODHD's count for today and keeps today's symbols", () => {
    expect(
      withSavedKey(
        previousKey,
        { dailyLimit: 100, requestsToday: 9, requestsDay: OCTOBER_1 },
        LATE_OCTOBER_1,
      ),
    ).toMatchObject({ calls: 9, dailyLimit: 100, symbols: ['AAPL.US'], keyGeneration: 5 });
  });

  it('starts the day over when EODHD gave no count, keeping the limit it has', () => {
    expect(withSavedKey(previousKey, undefined, LATE_OCTOBER_1)).toEqual({
      day: OCTOBER_1,
      calls: 0,
      dailyLimit: 20,
      symbols: [],
      keyGeneration: 5,
      backfilledFrom: { 'AAPL.US': OCTOBER_1 - 100 * DAY_MS },
    });
  });

  it('starts at the first key with nothing stored', () => {
    expect(withSavedKey(null, undefined, LATE_OCTOBER_1)).toEqual({
      day: OCTOBER_1,
      calls: 0,
      dailyLimit: 20,
      symbols: [],
      keyGeneration: 1,
    });
  });
});

describe('withRestoredKey', () => {
  it('marks the limit unconfirmed and the key new, keeping the calls this device spent', () => {
    expect(
      withRestoredKey(
        quota({
          calls: 7,
          dailyLimit: 100,
          keyGeneration: 2,
          isKeyRejected: true,
          backoff: { 'DEAD.US': { strikes: 1, retryDay: OCTOBER_1 + 2 * DAY_MS, lastLotDay: 0 } },
        }),
        LATE_OCTOBER_1,
      ),
    ).toEqual(quota({ calls: 7, dailyLimit: 100, keyGeneration: 3, isLimitUnconfirmed: true }));
  });

  it('starts a quota on a device with none, its limit unconfirmed', () => {
    expect(withRestoredKey(null, LATE_OCTOBER_1)).toEqual({
      day: OCTOBER_1,
      calls: 0,
      dailyLimit: 20,
      symbols: [],
      keyGeneration: 1,
      isLimitUnconfirmed: true,
    });
  });
});

describe('withRestoredPrices', () => {
  it("forgets which symbols were requested, backed off, or backfilled, keeping the day's calls and the key state", () => {
    expect(
      withRestoredPrices(
        quota({
          calls: 7,
          keyGeneration: 2,
          isLimitUnconfirmed: true,
          backoff: { 'DEAD.US': { strikes: 1, retryDay: OCTOBER_1 + 2 * DAY_MS, lastLotDay: 0 } },
          backfilledFrom: { 'AAPL.US': OCTOBER_1 - 100 * DAY_MS },
        }),
      ),
    ).toEqual(quota({ calls: 7, symbols: [], keyGeneration: 2, isLimitUnconfirmed: true }));
  });

  it('leaves no quota as none', () => {
    expect(withRestoredPrices(null)).toBeNull();
  });
});

describe('withoutRejection', () => {
  it('clears the rejection and keeps everything else', () => {
    expect(withoutRejection(quota({ isKeyRejected: true, keyGeneration: 2 }))).toEqual(
      quota({ keyGeneration: 2 }),
    );
  });
});

describe('withUnconfirmedLimit', () => {
  it('marks the daily limit as one EODHD has not confirmed', () => {
    expect(withUnconfirmedLimit(quota())).toEqual(quota({ isLimitUnconfirmed: true }));
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

describe('settle', () => {
  const settlement = (overrides: Partial<QuotaSettlement> = {}): QuotaSettlement => ({
    day: OCTOBER_1,
    reserved: 3,
    spent: 2,
    unanswered: ['SAP.XETRA'],
    usedUp: false,
    keyGeneration: 0,
    ...overrides,
  });
  const DEAD = { symbol: 'DEAD.US', lastLotDay: 500, firstLotDay: 100 };

  it('gives back the reserved calls never spent and the symbols never asked about', () => {
    expect(
      settle(quota({ calls: 8, symbols: ['AAPL.US', 'VOD.LSE', 'SAP.XETRA'] }), settlement()),
    ).toEqual(quota({ calls: 7, symbols: ['AAPL.US', 'VOD.LSE'] }));
  });

  it('keeps the daily limit and count stored since the refresh began', () => {
    expect(settle(quota({ calls: 9, dailyLimit: 100 }), settlement({ unanswered: [] }))).toEqual(
      quota({ calls: 8, dailyLimit: 100 }),
    );
  });

  it('never counts below zero', () => {
    expect(settle(quota({ calls: 1 }), settlement({ spent: 0, unanswered: [] }))).toEqual(
      quota({ calls: 0 }),
    );
  });

  it('marks the day used up when EODHD reported the daily limit', () => {
    expect(settle(quota({ calls: 8 }), settlement({ usedUp: true }))).toEqual(quota({ calls: 20 }));
  });

  it('leaves a quota stored for another UTC day alone', () => {
    const nextDay = quota({ day: OCTOBER_1 + DAY_MS, calls: 1 });

    expect(settle(nextDay, settlement({ usedUp: true }))).toEqual(nextDay);
  });

  it('leaves no stored quota as none', () => {
    expect(settle(null, settlement())).toBeNull();
  });

  it('marks the key rejected for the key the refresh used', () => {
    expect(
      settle(quota({ keyGeneration: 2 }), settlement({ keyGeneration: 2, isKeyRejected: true })),
    ).toMatchObject({ isKeyRejected: true });
  });

  it('marks the key rejected on a quota stored for another UTC day too', () => {
    const nextDay = quota({ day: OCTOBER_1 + DAY_MS, calls: 1 });

    expect(settle(nextDay, settlement({ isKeyRejected: true }))).toEqual({
      ...nextDay,
      isKeyRejected: true,
    });
  });

  it('never marks a key saved while the refresh was out as rejected', () => {
    expect(
      settle(quota({ keyGeneration: 3 }), settlement({ keyGeneration: 2, isKeyRejected: true })),
    ).not.toHaveProperty('isKeyRejected');
  });

  it('backs a struck symbol off for 2 days, then twice as long each time, up to 30 days', () => {
    const struck = (stored: QuoteQuota): QuoteQuota =>
      settle(stored, settlement({ struck: [DEAD] })) ?? stored;
    const retryDays = [1, 2, 3, 4, 5, 6].reduce<{ stored: QuoteQuota; days: number[] }>(
      ({ stored, days }) => {
        const next = struck(stored);

        return {
          stored: next,
          days: [...days, ((next.backoff?.['DEAD.US']?.retryDay ?? 0) - OCTOBER_1) / DAY_MS],
        };
      },
      { stored: quota(), days: [] },
    ).days;

    expect(retryDays).toEqual([2, 4, 8, 16, 30, 30]);
  });

  it('keeps the first lot a symbol was struck with', () => {
    expect(settle(quota(), settlement({ struck: [DEAD] }))?.backoff).toEqual({
      'DEAD.US': {
        strikes: 1,
        retryDay: OCTOBER_1 + 2 * DAY_MS,
        lastLotDay: 500,
        firstLotDay: 100,
      },
    });
  });

  it.each([
    ['a newer lot', { lastLotDay: 600 }],
    ['an older lot', { firstLotDay: 50 }],
  ])('starts the strikes over after %s', (_lot, lots) => {
    const stored = quota({
      backoff: {
        'DEAD.US': { strikes: 4, retryDay: OCTOBER_1, lastLotDay: 500, firstLotDay: 100 },
      },
    });

    expect(
      settle(stored, settlement({ struck: [{ ...DEAD, ...lots }] }))?.backoff?.['DEAD.US'],
    ).toMatchObject({ strikes: 1, retryDay: OCTOBER_1 + 2 * DAY_MS, ...lots });
  });

  describe('answers with no close', () => {
    const answeredEmpty = (stored: QuoteQuota, times: number): QuoteQuota =>
      Array.from({ length: times }).reduce<QuoteQuota>(
        (current) => settle(current, settlement({ empty: [DEAD] })) ?? current,
        stored,
      );

    it('counts them without holding the symbol back', () => {
      const stored = answeredEmpty(quota(), 9);

      expect(stored.backoff?.['DEAD.US']).toMatchObject({ emptyAnswers: 9 });
      expect(isBackedOff(stored, 'DEAD.US', 500)).toBe(false);
    });

    it('does not hold the symbol back over a week-long market holiday', () => {
      expect(isBackedOff(answeredEmpty(quota(), 7), 'DEAD.US', 500)).toBe(false);
    });

    it('backs the symbol off at the 10th in a row, then again at each one after', () => {
      const tenth = answeredEmpty(quota(), 10);
      const eleventh = answeredEmpty(tenth, 1);

      expect(tenth.backoff?.['DEAD.US']).toMatchObject({
        strikes: 1,
        retryDay: OCTOBER_1 + 2 * DAY_MS,
      });
      expect(eleventh.backoff?.['DEAD.US']).toMatchObject({
        strikes: 2,
        retryDay: OCTOBER_1 + 4 * DAY_MS,
      });
    });

    it('starts the count over after an answer with a close', () => {
      const answered = settle(answeredEmpty(quota(), 9), settlement({ answered: ['DEAD.US'] }));

      expect(answeredEmpty(answered ?? quota(), 9).backoff?.['DEAD.US']).toMatchObject({
        strikes: 0,
        emptyAnswers: 9,
      });
    });
  });

  it('forgets the back-off of a symbol EODHD answered', () => {
    const stored = quota({
      backoff: {
        'DEAD.US': { strikes: 1, retryDay: OCTOBER_1, lastLotDay: 500 },
        'GONE.US': { strikes: 1, retryDay: OCTOBER_1, lastLotDay: 500 },
      },
    });

    expect(settle(stored, settlement({ answered: ['DEAD.US'] }))?.backoff).toEqual({
      'GONE.US': { strikes: 1, retryDay: OCTOBER_1, lastLotDay: 500 },
    });
  });

  it('never backs off a symbol for a key saved while the refresh was out', () => {
    expect(
      settle(quota({ keyGeneration: 1 }), settlement({ keyGeneration: 0, struck: [DEAD] })),
    ).not.toHaveProperty('backoff');
  });

  it('keeps the earliest day each series was answered from', () => {
    const stored = quota({ backfilledFrom: { 'AAPL.US': 300, 'SAP.XETRA': 100 } });

    expect(
      settle(
        stored,
        settlement({ keyGeneration: 9, backfilledFrom: { 'AAPL.US': 200, 'SAP.XETRA': 150 } }),
      )?.backfilledFrom,
    ).toEqual({ 'AAPL.US': 200, 'SAP.XETRA': 100 });
  });
});

describe('withUserLimits', () => {
  it('confirms a daily limit read from EODHD', () => {
    const confirmed = withUserLimits(
      quota({ isLimitUnconfirmed: true }),
      { dailyLimit: 100, requestsToday: 9, requestsDay: OCTOBER_1 },
      LATE_OCTOBER_1,
    );

    expect(confirmed).not.toHaveProperty('isLimitUnconfirmed');
    expect(confirmed).toEqual(quota({ calls: 9, dailyLimit: 100 }));
  });

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
