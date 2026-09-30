// Semgrep fixture (NEGATIVE, NESTED): a real-clock fixture steps local calendar
// days, a fixed-millisecond offset starts from a pinned instant, and an
// elapsed-time or sub-day offset is not a day step.
import { DAY_MS, endOfLocalDay, startOfLocalDay } from '@kiko/dates';

const PINNED_NOON = new Date(2026, 2, 29, 12).getTime();

export const localDaysFrom = (time: number, days: number): number => {
  const date = new Date(time);
  date.setDate(date.getDate() + days);

  return date.getTime();
};

export const tomorrow = (): number => localDaysFrom(Date.now(), 1);

export const pinnedTomorrow = (): number => PINNED_NOON + DAY_MS;

export const startOfTomorrow = (): number => endOfLocalDay(Date.now()) + 1;

export const elapsedMilliseconds = (startedAt: number): number => Date.now() - startedAt;

export const sinceStartOfToday = (startOfToday: number): number => Date.now() - startOfToday;

export const afterHoliday = (holidayLength: number): number => Date.now() + holidayLength;

export const sinceLastMonday = (lastMonday: number): number => Date.now() - lastMonday;

export const overdueDayCount = (openedAt: number, graceDays: number): number => {
  const overdueDays = Math.floor((Date.now() - openedAt) / DAY_MS) - graceDays;

  return overdueDays;
};

export const sinceDatePoints = (
  startOfDay: (time: number) => number,
  lastDay: number,
): number[] => {
  const now = Date.now();

  return [
    Date.now() - startOfDay(now),
    Date.now() - lastDay,
    now - startOfLocalDay(now),
    Date.now() - endOfLocalDay(now),
  ];
};

export const sinceMoreDatePoints = (
  startOfUtcDay: (time: number) => number,
  nextDay: number,
  previousDay: number,
): number[] => [
  Date.now() - startOfUtcDay(Date.now()),
  nextDay - Date.now(),
  Date.now() - nextDay,
  Date.now() - previousDay,
];

export const pinnedClockTomorrow = (): number => {
  jest.setSystemTime(PINNED_NOON);

  return Date.now() + DAY_MS;
};

export const fakeTimersTomorrow = (): number => {
  jest.useFakeTimers({ doNotFake: ['nextTick'], now: PINNED_NOON });

  return Date.now() + DAY_MS;
};
