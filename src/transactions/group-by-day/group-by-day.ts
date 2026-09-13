import type { TFunction } from 'i18next';

import { formatDate } from '../../dates/format';
import { startOfLocalDay } from '../../dates/local-day';

// A day's worth of rows, headed by a human-readable label. A transaction list
// renders a SectionList of these — one section per calendar day, newest day
// first. Generic over any row that carries a `time`, so both the Home
// transaction list and the holding-detail ledger (which also folds in derived
// lifecycle entries) share the exact same grouping.
export type DaySection<Row> = { title: string; data: Row[] };

// "Today"/"Yesterday" for the two most recent days, otherwise the shared
// explicit DD.MM.YYYY format (locale-independent). `now` is passed in rather
// than read here so the mapping stays pure and testable; `t` is passed in for
// the same reason (a hook can only be called from the component itself).
const dayHeader = (dayStart: number, now: number, t: TFunction): string => {
  const today = startOfLocalDay(now);
  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);

  if (dayStart === today) {
    return t('home.today');
  }
  if (dayStart === yesterdayDate.getTime()) {
    return t('home.yesterday');
  }

  return formatDate(dayStart);
};

// Fold rows (already ordered newest-first by the query) into per-day sections,
// preserving that order: same-day rows are consecutive, so a section closes as
// soon as the day changes. Sections therefore come out newest-day-first with
// each day's rows newest-first.
export const groupByDay = <Row extends { time: number }>(
  rows: readonly Row[],
  now: number,
  t: TFunction,
): DaySection<Row>[] => {
  const sections: DaySection<Row>[] = [];

  for (const row of rows) {
    const dayStart = startOfLocalDay(row.time);
    const openSection = sections.at(-1);

    if (openSection && startOfLocalDay(openSection.data[0].time) === dayStart) {
      openSection.data.push(row);
    } else {
      sections.push({ title: dayHeader(dayStart, now, t), data: [row] });
    }
  }

  return sections;
};
