import { DAY_MS, startOfLocalDay } from '@kiko/dates';

// Semgrep fixture (NEGATIVE): local calendar fields step the day, then the
// local day is taken. A sub-day offset is not a day step, and a span applied
// after `startOfLocalDay` returns is a different shape, out of this rule.

const HOUR = 3_600_000;

export const today = (now: number): number => startOfLocalDay(now);

export const defaultRangeFrom = (now: number): Date => {
  const date = new Date(now);

  return new Date(
    startOfLocalDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 30).getTime()),
  );
};

export const anHourAgoLocalDay = (now: number): number => startOfLocalDay(now - HOUR);

export const midnightLessADay = (time: number): number => startOfLocalDay(time) - DAY_MS;

// `dayStart` is a point in time, not a day span.
export const anHourIntoTheDay = (dayStart: number): number => startOfLocalDay(dayStart + HOUR);
