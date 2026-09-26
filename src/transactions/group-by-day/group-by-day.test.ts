import type { TFunction } from 'i18next';
import { formatDate, startOfLocalDay } from '@kiko/dates';

import { groupByDay } from './group-by-day';

// A fake `TFunction` that echoes its key back, so the "Today"/"Yesterday"
// branches assert on the exact key the mapping asks for without pulling in the
// i18n runtime.
const t = ((key: string): string => key) as unknown as TFunction;

const DAY_MS = 24 * 60 * 60 * 1000;

describe('groupByDay', () => {
  it('returns no sections for an empty list', () => {
    expect(groupByDay([], Date.now(), t)).toEqual([]);
  });

  it('folds same-day rows into a single section, preserving their order', () => {
    const now = startOfLocalDay(Date.now()) + 12 * 60 * 60 * 1000;
    const rows = [{ time: now }, { time: now - 60 * 1000 }, { time: now - 120 * 1000 }];

    const sections = groupByDay(rows, now, t);

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('home.today');
    expect(sections[0].data).toEqual(rows);
  });

  it('opens a new section per calendar day, newest day first', () => {
    const todayNoon = startOfLocalDay(Date.now()) + 12 * 60 * 60 * 1000;
    const yesterdayNoon = todayNoon - DAY_MS;
    const rows = [{ time: todayNoon }, { time: yesterdayNoon }];

    const sections = groupByDay(rows, todayNoon, t);

    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('home.today');
    expect(sections[0].data).toEqual([{ time: todayNoon }]);
    expect(sections[1].title).toBe('home.yesterday');
    expect(sections[1].data).toEqual([{ time: yesterdayNoon }]);
  });

  it('labels an older day with the explicit DD.MM.YYYY date', () => {
    const todayNoon = startOfLocalDay(Date.now()) + 12 * 60 * 60 * 1000;
    const olderNoon = todayNoon - 5 * DAY_MS;

    const sections = groupByDay([{ time: olderNoon }], todayNoon, t);

    expect(sections[0].title).toBe(formatDate(startOfLocalDay(olderNoon)));
  });
});
