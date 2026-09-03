import { toUtcMidnight } from './history-entry';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('toUtcMidnight', () => {
  it('leaves an already-midnight instant unchanged', () => {
    const midnight = Date.UTC(2026, 8, 1); // 2026-09-01T00:00:00.000Z
    expect(toUtcMidnight(midnight)).toBe(midnight);
  });

  it('floors an intraday instant down to its UTC midnight', () => {
    const midnight = Date.UTC(2026, 8, 1);
    const intraday = midnight + 13 * 60 * 60 * 1000 + 42; // same day, later
    expect(toUtcMidnight(intraday)).toBe(midnight);
  });

  it('never rounds up to the next day', () => {
    const midnight = Date.UTC(2026, 8, 1);
    const almostNext = midnight + DAY_MS - 1;
    expect(toUtcMidnight(almostNext)).toBe(midnight);
  });
});
