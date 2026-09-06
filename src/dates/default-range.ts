import { DAY_MS } from './duration';

type DateRange = { from: Date; to: Date };

// Midnight (local time) of the calendar day a timestamp falls on. Kept local
// to this module (mirrors the near-identical helper each screen already
// defines for its own day-boundary math) so this module has no dependency on
// either screen.
const startOfLocalDay = (time: number): Date => {
  const date = new Date(time);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

// The default filter window: the last 30 days ending today (local time).
// `from` is the start of the local day 30 days before `now`; `to` is `now`
// itself (today, at the instant this is called). One source of truth so the
// Home transaction filter and the Charts date range open on the same window,
// and both screens' Clear actions return to it instead of to all-time.
export const defaultDateRange = (now: number = Date.now()): DateRange => {
  const from = startOfLocalDay(now - 30 * DAY_MS);
  const to = new Date(now);

  return { from, to };
};
