import {
  reduceShare,
  ownershipAt,
  sharePercentText,
  ownershipApplies,
  parsePercentShare,
  asOwnershipChanges,
  parseFractionShare,
  withOwnershipChange,
} from './ownership';

// UTC-midnight day keys, the `dayKeyOf` convention `lots.test.ts` uses, so a
// read resolves to the same day on any machine timezone.
const DAY = 86_400_000;
const day1 = Date.UTC(2026, 0, 1);
const day10 = day1 + 9 * DAY;
const day20 = day1 + 19 * DAY;

describe('reduceShare', () => {
  it('reduces by the greatest common divisor', () => {
    expect(reduceShare(2, 6)).toEqual({ numerator: 1, denominator: 3 });
    expect(reduceShare(5000, 10000)).toEqual({ numerator: 1, denominator: 2 });
    expect(reduceShare(3, 3)).toEqual({ numerator: 1, denominator: 1 });
  });
});

describe('parsePercentShare', () => {
  it('reads a percent as a reduced fraction of 10000', () => {
    expect(parsePercentShare('50')).toEqual({ numerator: 1, denominator: 2 });
    expect(parsePercentShare('33.33')).toEqual({ numerator: 3333, denominator: 10000 });
    expect(parsePercentShare('100')).toEqual({ numerator: 1, denominator: 1 });
  });

  it('accepts a comma decimal mark', () => {
    expect(parsePercentShare('12,5')).toEqual({ numerator: 1, denominator: 8 });
  });

  it('rejects zero, above 100, three decimals, and junk', () => {
    expect(parsePercentShare('0')).toBeNull();
    expect(parsePercentShare('0.00')).toBeNull();
    expect(parsePercentShare('101')).toBeNull();
    expect(parsePercentShare('100.01')).toBeNull();
    expect(parsePercentShare('33.333')).toBeNull();
    expect(parsePercentShare('')).toBeNull();
    expect(parsePercentShare('abc')).toBeNull();
    expect(parsePercentShare('-5')).toBeNull();
  });
});

describe('parseFractionShare', () => {
  it('reads two positive integers as a reduced fraction', () => {
    expect(parseFractionShare('2', '6')).toEqual({ numerator: 1, denominator: 3 });
    expect(parseFractionShare('1', '1')).toEqual({ numerator: 1, denominator: 1 });
  });

  it('rejects zero, a numerator above the denominator, and a non-integer', () => {
    expect(parseFractionShare('0', '3')).toBeNull();
    expect(parseFractionShare('1', '0')).toBeNull();
    expect(parseFractionShare('2', '1')).toBeNull();
    expect(parseFractionShare('1.5', '3')).toBeNull();
    expect(parseFractionShare('', '3')).toBeNull();
    expect(parseFractionShare('-1', '3')).toBeNull();
  });
});

describe('asOwnershipChanges', () => {
  it('accepts a sorted list of reduced shares on unique days', () => {
    const changes = [
      { day: day1, numerator: 1, denominator: 2 },
      { day: day10, numerator: 1, denominator: 3 },
    ];

    expect(asOwnershipChanges(changes)).toEqual(changes);
    expect(asOwnershipChanges([])).toEqual([]);
  });

  it('rejects the whole list when any entry is invalid', () => {
    const valid = { day: day1, numerator: 1, denominator: 2 };

    expect(asOwnershipChanges([valid, { day: day10, numerator: 0, denominator: 2 }])).toBeNull();
    expect(asOwnershipChanges([{ day: day1, numerator: 3, denominator: 2 }])).toBeNull();
    expect(asOwnershipChanges([{ day: day1, numerator: 2, denominator: 4 }])).toBeNull();
    expect(asOwnershipChanges([{ day: day1, numerator: 0.5, denominator: 1 }])).toBeNull();
    expect(asOwnershipChanges([{ day: 'x', numerator: 1, denominator: 2 }])).toBeNull();
    expect(asOwnershipChanges([{ day: day1, numerator: 1 }])).toBeNull();
    expect(asOwnershipChanges([null])).toBeNull();
  });

  it('rejects an unsorted list or a repeated day', () => {
    const first = { day: day10, numerator: 1, denominator: 2 };
    const second = { day: day1, numerator: 1, denominator: 3 };

    expect(asOwnershipChanges([first, second])).toBeNull();
    expect(asOwnershipChanges([first, { ...first, numerator: 1, denominator: 3 }])).toBeNull();
  });

  it('rejects a value that is not an array', () => {
    expect(asOwnershipChanges({ day: day1 })).toBeNull();
    expect(asOwnershipChanges(undefined)).toBeNull();
  });
});

describe('ownershipAt', () => {
  const changes = [
    { day: day10, numerator: 1, denominator: 1 },
    { day: day20, numerator: 1, denominator: 2 },
  ];

  it('reads the whole asset with no changes', () => {
    expect(ownershipAt([], day1)).toEqual({ numerator: 1, denominator: 1 });
  });

  it('reads the latest change on or before the instant', () => {
    expect(ownershipAt(changes, day10 + 3 * DAY)).toEqual({ numerator: 1, denominator: 1 });
    expect(ownershipAt(changes, day20)).toEqual({ numerator: 1, denominator: 2 });
    expect(ownershipAt(changes, day20 + 40 * DAY)).toEqual({ numerator: 1, denominator: 2 });
  });

  it('carries the first change back to an instant before it', () => {
    const createdAtHalf = [{ day: day10, numerator: 1, denominator: 2 }];

    expect(ownershipAt(createdAtHalf, day1)).toEqual({ numerator: 1, denominator: 2 });
  });

  it('reads a change on a later hour of its own day', () => {
    expect(ownershipAt(changes, day20 + 13 * 3_600_000)).toEqual({
      numerator: 1,
      denominator: 2,
    });
  });
});

describe('withOwnershipChange', () => {
  it('adds a change in day order', () => {
    const existing = [{ day: day20, numerator: 1, denominator: 2 }];

    expect(withOwnershipChange(existing, { day: day1, numerator: 1, denominator: 1 })).toEqual([
      { day: day1, numerator: 1, denominator: 1 },
      { day: day20, numerator: 1, denominator: 2 },
    ]);
  });

  it('replaces a change on the same day', () => {
    const existing = [
      { day: day1, numerator: 1, denominator: 1 },
      { day: day20, numerator: 1, denominator: 2 },
    ];

    expect(withOwnershipChange(existing, { day: day20, numerator: 1, denominator: 3 })).toEqual([
      { day: day1, numerator: 1, denominator: 1 },
      { day: day20, numerator: 1, denominator: 3 },
    ]);
  });

  it('drops a change equal to the share already in effect', () => {
    const existing = [{ day: day1, numerator: 1, denominator: 2 }];

    expect(withOwnershipChange(existing, { day: day10, numerator: 1, denominator: 2 })).toEqual(
      existing,
    );
    expect(withOwnershipChange([], { day: day10, numerator: 1, denominator: 1 })).toEqual([]);
  });

  it('drops a later change the new one makes redundant', () => {
    const existing = [
      { day: day1, numerator: 1, denominator: 2 },
      { day: day20, numerator: 1, denominator: 3 },
    ];

    expect(withOwnershipChange(existing, { day: day10, numerator: 1, denominator: 3 })).toEqual([
      { day: day1, numerator: 1, denominator: 2 },
      { day: day10, numerator: 1, denominator: 3 },
    ]);
  });
});

describe('ownershipApplies', () => {
  it('applies to every category but a loan given', () => {
    expect(ownershipApplies('real_estate')).toBe(true);
    expect(ownershipApplies('vehicle')).toBe(true);
    expect(ownershipApplies('valuable')).toBe(true);
    expect(ownershipApplies('business_share')).toBe(true);
    expect(ownershipApplies('other')).toBe(true);
    expect(ownershipApplies('loan_given')).toBe(false);
  });
});

describe('sharePercentText', () => {
  it('prints the percent with up to two decimals, rounded half away from zero', () => {
    expect(sharePercentText({ numerator: 1, denominator: 3 })).toBe('33.33');
    expect(sharePercentText({ numerator: 2, denominator: 3 })).toBe('66.67');
    expect(sharePercentText({ numerator: 1, denominator: 2 })).toBe('50');
    expect(sharePercentText({ numerator: 1, denominator: 8 })).toBe('12.5');
    expect(sharePercentText({ numerator: 1, denominator: 1 })).toBe('100');
  });
});
