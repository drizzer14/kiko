import { DAY_MS } from '@kiko/dates';

import {
  type HistoryRateEntry,
  groupTimelines,
  nearestAtOrBefore,
  toUtcMidnight,
} from './history-entry';

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

const FIRST_DAY = Date.UTC(2026, 8, 1);

const entry = (base: 'USD' | 'EUR', index: number, rate: number): HistoryRateEntry => ({
  base,
  quote: 'UAH',
  day: FIRST_DAY + index * DAY_MS,
  rate,
  source: 'nbu',
});

describe('groupTimelines', () => {
  it('groups the entries of one pair into an ascending timeline', () => {
    const timelines = groupTimelines([
      entry('USD', 2, 42),
      entry('EUR', 0, 43),
      entry('USD', 0, 40),
    ]);

    expect(timelines.get('USD:UAH')?.map((point) => point.rate)).toEqual([40, 42]);
    expect(timelines.get('EUR:UAH')?.map((point) => point.rate)).toEqual([43]);
    expect(timelines.has('GBP:UAH')).toBe(false);
  });
});

describe('nearestAtOrBefore', () => {
  const timeline = [entry('USD', 0, 40), entry('USD', 2, 42)];

  it('reads the rate of the day itself', () => {
    expect(nearestAtOrBefore(timeline, FIRST_DAY + 2 * DAY_MS)).toBe(42);
  });

  it('carries the earlier rate across a gap', () => {
    expect(nearestAtOrBefore(timeline, FIRST_DAY + DAY_MS)).toBe(40);
  });

  it('has no rate before the first point', () => {
    expect(nearestAtOrBefore(timeline, FIRST_DAY - DAY_MS)).toBeUndefined();
  });

  it('reads the last rate after the last point', () => {
    expect(nearestAtOrBefore(timeline, FIRST_DAY + 9 * DAY_MS)).toBe(42);
  });
});
