import { kyivOffsetHours, kyivWallClockToUtcMilliseconds, utcDigitsOf } from './kyiv-wall-clock';

const parts = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
) => ({
  year,
  month,
  day,
  hour,
  minute,
  second,
});

describe('kyivOffsetHours', () => {
  it('is +3 in summer', () => {
    expect(kyivOffsetHours(parts(2026, 9, 15, 22, 30))).toBe(3);
  });

  it('is +2 in winter', () => {
    expect(kyivOffsetHours(parts(2026, 1, 15, 22, 30))).toBe(2);
  });
});

describe('kyivWallClockToUtcMilliseconds', () => {
  it('converts a summer evening wall clock to UTC', () => {
    expect(kyivWallClockToUtcMilliseconds(parts(2026, 9, 15, 22, 30, 0))).toBe(
      Date.UTC(2026, 8, 15, 19, 30, 0),
    );
  });

  it('converts a winter evening wall clock to UTC', () => {
    expect(kyivWallClockToUtcMilliseconds(parts(2026, 1, 15, 22, 30, 0))).toBe(
      Date.UTC(2026, 0, 15, 20, 30, 0),
    );
  });

  it('reads just before the spring-forward gap as +2', () => {
    expect(kyivWallClockToUtcMilliseconds(parts(2026, 3, 29, 2, 59, 59))).toBe(
      Date.UTC(2026, 2, 29, 0, 59, 59),
    );
  });

  it('reads a spring-gap wall clock (forward, +2) inside the missing hour', () => {
    expect(kyivWallClockToUtcMilliseconds(parts(2026, 3, 29, 3, 30, 0))).toBe(
      Date.UTC(2026, 2, 29, 1, 30, 0),
    );
  });

  it('reads the first summer instant (+3) right at the spring boundary', () => {
    expect(kyivWallClockToUtcMilliseconds(parts(2026, 3, 29, 4, 0, 0))).toBe(
      Date.UTC(2026, 2, 29, 1, 0, 0),
    );
  });

  it('reads an autumn repeated hour as the earlier (+3) instant', () => {
    expect(kyivWallClockToUtcMilliseconds(parts(2026, 10, 25, 3, 30, 0))).toBe(
      Date.UTC(2026, 9, 25, 0, 30, 0),
    );
  });

  it('reads the first winter instant (+2) right at the autumn boundary', () => {
    expect(kyivWallClockToUtcMilliseconds(parts(2026, 10, 25, 4, 0, 0))).toBe(
      Date.UTC(2026, 9, 25, 2, 0, 0),
    );
  });

  it('converts a different year’s spring boundary (2024)', () => {
    expect(kyivWallClockToUtcMilliseconds(parts(2024, 3, 31, 4, 0, 0))).toBe(
      Date.UTC(2024, 2, 31, 1, 0, 0),
    );
  });

  it('converts a different year’s autumn boundary (2024)', () => {
    expect(kyivWallClockToUtcMilliseconds(parts(2024, 10, 27, 4, 0, 0))).toBe(
      Date.UTC(2024, 9, 27, 2, 0, 0),
    );
  });

  it('rejects a day that rolls over (February has no 31st)', () => {
    expect(kyivWallClockToUtcMilliseconds(parts(2026, 2, 31, 10, 0))).toBeUndefined();
  });

  it('rejects an out-of-range hour/minute that rolls over', () => {
    expect(kyivWallClockToUtcMilliseconds(parts(2026, 9, 15, 25, 61))).toBeUndefined();
  });
});

describe('utcDigitsOf', () => {
  it('round-trips a UTC instant back to its own calendar parts', () => {
    const milliseconds = Date.UTC(2026, 8, 15, 22, 30, 0);

    expect(utcDigitsOf(milliseconds)).toEqual(parts(2026, 9, 15, 22, 30, 0));
  });
});
