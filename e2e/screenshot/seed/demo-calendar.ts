import { DAY_MS } from '@kiko/dates';

/**
 * Every date the demo dataset holds, measured from one anchor. Offsets are
 * whole days, so the dataset keeps the same shape whichever day it is built on.
 */
export type DemoCalendar = {
  /** The "now" the dataset is built for: 09:00 UTC on its anchor day. */
  anchor: number;
  /** 09:00 UTC, `daysAgo` days before the anchor. */
  at: (daysAgo: number) => number;
  /** 09:00 UTC, `daysAhead` days after the anchor. */
  ahead: (daysAhead: number) => number;
  /** A `price_points.day`-style key: UTC midnight, `daysAgo` days before the anchor day. */
  dayKeyAt: (daysAgo: number) => number;
  /** The anchor's day of the month, `monthsAgo` months back, held to a shorter month's last day. */
  monthKeyAt: (monthsAgo: number) => number;
};

export const buildDemoCalendar = (anchor: number): DemoCalendar => {
  const anchorDay = anchor - (anchor % DAY_MS);
  const anchorDate = new Date(anchorDay);

  return {
    anchor,
    at: (daysAgo) => anchor - daysAgo * DAY_MS,
    ahead: (daysAhead) => anchor + daysAhead * DAY_MS,
    dayKeyAt: (daysAgo) => anchorDay - daysAgo * DAY_MS,
    monthKeyAt: (monthsAgo) => {
      const year = anchorDate.getUTCFullYear();
      const monthIndex = anchorDate.getUTCMonth() - monthsAgo;
      const lastDayOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

      return Date.UTC(year, monthIndex, Math.min(anchorDate.getUTCDate(), lastDayOfMonth));
    },
  };
};
