type DateRange = { from: Date; to: Date };

// The default filter window: the last 30 days ending today (local time).
// `from` is local midnight of the calendar date 30 days before `now`; `to` is
// `now` itself (today, at the instant this is called). One source of truth so
// the Home transaction filter and the Charts date range open on the same
// window, and both screens' Clear actions return to it instead of to all-time.
//
// `from` steps back calendar fields, never `now - 30 * DAY_MS`: a 23- or
// 25-hour DST day inside the window made the fixed offset land one day early
// (spring, `now` just after midnight) or one day late (autumn, `now` just
// before midnight). `new Date(y, m, d - 30)` normalizes across month and year.
export const defaultDateRange = (now: number = Date.now()): DateRange => {
  const today = new Date(now);
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);
  const to = new Date(now);

  return { from, to };
};
