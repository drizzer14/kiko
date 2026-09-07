import { DAY_MS } from './duration';
import { startOfLocalDay } from './local-day';

type DateRange = { from: Date; to: Date };

// The default filter window: the last 30 days ending today (local time).
// `from` is the start of the local day 30 days before `now`; `to` is `now`
// itself (today, at the instant this is called). One source of truth so the
// Home transaction filter and the Charts date range open on the same window,
// and both screens' Clear actions return to it instead of to all-time.
export const defaultDateRange = (now: number = Date.now()): DateRange => {
  const from = new Date(startOfLocalDay(now - 30 * DAY_MS));
  const to = new Date(now);

  return { from, to };
};
