import { isMidnightWallClock, isRealCalendarInstant } from './wall-clock-parts';

const parts = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
) => ({ year, month, day, hour, minute, second });

describe('isRealCalendarInstant', () => {
  it('accepts an ordinary calendar/time combination', () => {
    expect(isRealCalendarInstant(parts(2026, 9, 15, 22, 30, 0))).toBe(true);
  });

  it('accepts 29 February on a leap year', () => {
    expect(isRealCalendarInstant(parts(2024, 2, 29, 0, 0, 0))).toBe(true);
  });

  it('rejects 29 February on a non-leap year', () => {
    expect(isRealCalendarInstant(parts(2025, 2, 29, 0, 0, 0))).toBe(false);
  });

  it('rejects a day that rolls over (February has no 31st)', () => {
    expect(isRealCalendarInstant(parts(2026, 2, 31, 10, 0))).toBe(false);
  });

  it('rejects an out-of-range hour/minute that rolls over', () => {
    expect(isRealCalendarInstant(parts(2026, 9, 15, 25, 61))).toBe(false);
  });
});

describe('isMidnightWallClock', () => {
  it('is true for an exact 00:00:00', () => {
    expect(isMidnightWallClock(parts(2026, 9, 15, 0, 0, 0))).toBe(true);
  });

  it('is false for any non-zero time-of-day', () => {
    expect(isMidnightWallClock(parts(2026, 9, 15, 0, 0, 1))).toBe(false);
    expect(isMidnightWallClock(parts(2026, 9, 15, 12, 0, 0))).toBe(false);
  });
});
