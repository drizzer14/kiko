// Explicit, locale-independent date formatting. The device locale would
// otherwise reorder fields (MM/DD vs DD/MM), so every component is read off the
// Date and assembled by hand into a fixed layout. Only the clock (12- or
// 24-hour) is the caller's, through `TimeClock`.

const pad2 = (value: number): string => value.toString().padStart(2, '0');

const toDate = (input: number | Date): Date => {
  return input instanceof Date ? input : new Date(input);
};

// "DD.MM.YYYY" in the device's local timezone, every field zero-padded. Pass
// `{ timeZone: 'UTC' }` when the caller's own instant is a UTC-midnight value
// standing for a LOCAL calendar date (e.g. `price_points.day` — see
// `formatDayMonth`'s matching option, and `dayKeyOf` in
// `src/prices/price-book/`): reading such a value with the LOCAL getters can
// land on the previous calendar day in a negative-UTC-offset timezone.
export const formatDate = (input: number | Date, options?: { timeZone?: 'UTC' }): string => {
  const date = toDate(input);
  const day = options?.timeZone === 'UTC' ? date.getUTCDate() : date.getDate();
  const month = options?.timeZone === 'UTC' ? date.getUTCMonth() : date.getMonth();
  const year = options?.timeZone === 'UTC' ? date.getUTCFullYear() : date.getFullYear();

  return `${pad2(day)}.${pad2(month + 1)}.${year}`;
};

// "DD.MM", zero-padded day-then-month with no year — a compact numeric label
// for a chart X-axis, where the plotted range is always read against a visible
// recent window rather than needing the year spelled out. Reads LOCAL calendar
// fields by default; pass `{ timeZone: 'UTC' }` when the caller's own instants
// are UTC-midnight (e.g. a UTC calendar-day bucket) so a negative-UTC-offset
// locale does not read one calendar day early.
export const formatDayMonth = (input: number | Date, options?: { timeZone?: 'UTC' }): string => {
  const date = toDate(input);
  const day = options?.timeZone === 'UTC' ? date.getUTCDate() : date.getDate();
  const month = options?.timeZone === 'UTC' ? date.getUTCMonth() : date.getMonth();

  return `${pad2(day)}.${pad2(month + 1)}`;
};

/**
 * How a time of day reads: on the 24-hour clock, or on the 12-hour one with
 * the language's own marks for the hours before and after noon. It follows
 * the iOS 24-Hour Time setting (`useTimeClock` in `@kiko/i18n/use-time-clock`),
 * so a time reads the same as in the system's own time pickers.
 */
export type TimeClock =
  | { uses24Hour: true }
  | { uses24Hour: false; beforeNoon: string; afterNoon: string };

// Keeps the mark on the same line as its time.
const NO_BREAK_SPACE = '\xA0';

/** The hour a clock face shows: 0-23 on the 24-hour clock, 1-12 on the 12-hour one. */
export const hourOnClock = (hours: number, clock: TimeClock): number =>
  clock.uses24Hour ? hours : hours % 12 || 12;

// The time of day in the device's local timezone: "HH:MM" on the 24-hour
// clock, both fields zero-padded (09:05, 00:00, 23:59); "H:MM" and the mark
// on the 12-hour one (9:05 PM, 12:00 AM).
export const formatTime = (input: number | Date, clock: TimeClock): string => {
  const date = toDate(input);
  const hours = date.getHours();
  const minutes = pad2(date.getMinutes());

  if (clock.uses24Hour) {
    return `${pad2(hours)}:${minutes}`;
  }

  const mark = hours < 12 ? clock.beforeNoon : clock.afterNoon;

  return `${hourOnClock(hours, clock)}:${minutes}${NO_BREAK_SPACE}${mark}`;
};

// "DD.MM.YYYY" and the time of day (`formatTime`), in the device's local timezone.
export const formatDateTime = (input: number | Date, clock: TimeClock): string => {
  const date = toDate(input);

  return `${formatDate(date)} ${formatTime(date, clock)}`;
};

// Parses a 'YYYY-MM-DD' calendar day into a LOCAL-midnight timestamp, matching
// DateField (new Date(y, m-1, d)) and the interest-boundary arithmetic. Plain
// Date.parse reads the string as UTC midnight, which lands on the previous or
// next local day in a non-UTC zone (e.g. +02:00/+03:00 Kyiv). Returns NaN for a
// malformed string or an out-of-range day so callers can reject invalid input.
export const parseLocalDate = (value: string): number => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

  if (match === null) {
    return Number.NaN;
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  // Reject rollover (e.g. 2026-13-01 or 2026-02-30): the components must survive
  // the round-trip unchanged.
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
    return Number.NaN;
  }

  return date.getTime();
};
