import { DAY_MS } from '@kiko/dates';

import { asLots, costBasisMinorAt, quantityAt } from './lots';

// Matches price-book.test.ts's own convention: a UTC-midnight anchor day, so
// `dayKeyOf` (which reads local Y/M/D getters) resolves back to the same
// instant regardless of the test machine's own timezone offset.
const day1 = Date.UTC(2026, 0, 1); // 2026-01-01
const day15 = day1 + 14 * DAY_MS; // 2026-01-15
const day20 = day1 + 19 * DAY_MS; // 2026-01-20

describe('quantityAt', () => {
  it('sums quantity deltas up to the local day of the given instant', () => {
    const lots = [
      { day: day1, quantityDelta: '10', costMinorUnits: 100_000 },
      { day: day15, quantityDelta: '5', costMinorUnits: 50_000 },
    ];

    expect(quantityAt(lots, day1 + 5 * DAY_MS)).toBe('10');
    expect(quantityAt(lots, day20)).toBe('15');
  });

  it('ignores a lot dated after the given instant', () => {
    const lots = [{ day: day20, quantityDelta: '3', costMinorUnits: 30_000 }];

    expect(quantityAt(lots, day1)).toBe('0');
  });

  it('never returns below "0" — a sell delta larger than the held quantity clamps', () => {
    const lots = [
      { day: day1, quantityDelta: '10', costMinorUnits: 100_000 },
      { day: day15, quantityDelta: '-25', costMinorUnits: 0 },
    ];

    expect(quantityAt(lots, day20)).toBe('0');
  });

  it('returns "0" for an empty lot list', () => {
    expect(quantityAt([], day1)).toBe('0');
  });
});

describe('costBasisMinorAt', () => {
  it('sums cost basis up to the given instant', () => {
    const lots = [
      { day: day1, quantityDelta: '10', costMinorUnits: 100_000 },
      { day: day15, quantityDelta: '5', costMinorUnits: 50_000 },
    ];

    expect(costBasisMinorAt(lots, day20)).toBe(150_000);
  });

  it('ignores a lot dated after the given instant', () => {
    const lots = [{ day: day20, quantityDelta: '3', costMinorUnits: 30_000 }];

    expect(costBasisMinorAt(lots, day1)).toBe(0);
  });
});

describe('asLots', () => {
  it('parses a valid lot array', () => {
    const value = [{ day: day1, quantityDelta: '10', costMinorUnits: 100_000 }];

    expect(asLots(value)).toEqual(value);
  });

  it('accepts an empty array', () => {
    expect(asLots([])).toEqual([]);
  });

  it('accepts a signed (negative) quantityDelta for a sell', () => {
    const value = [{ day: day1, quantityDelta: '-5', costMinorUnits: -50_000 }];

    expect(asLots(value)).toEqual(value);
  });

  it('returns null for a non-array', () => {
    expect(asLots(null)).toBeNull();
    expect(asLots({})).toBeNull();
  });

  it('rejects a non-decimal quantityDelta', () => {
    const value = [{ day: day1, quantityDelta: 'abc', costMinorUnits: 100_000 }];

    expect(asLots(value)).toBeNull();
  });

  it('rejects a lot missing a field', () => {
    expect(asLots([{ day: day1, quantityDelta: '10' }])).toBeNull();
  });

  it('rejects the whole array when one lot among several is invalid', () => {
    const value = [
      { day: day1, quantityDelta: '10', costMinorUnits: 100_000 },
      { day: day15, quantityDelta: 'nope', costMinorUnits: 50_000 },
    ];

    expect(asLots(value)).toBeNull();
  });
});
