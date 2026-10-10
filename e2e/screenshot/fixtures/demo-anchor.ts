// Picks the anchor a regeneration builds the demo dataset for. Pure: the clock
// is an argument, so a test never depends on the day it runs.

// 09:00 UTC falls on the same calendar day in every timezone from UTC-9 to UTC+14.
const ANCHOR_HOUR_UTC = 9;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` -> 09:00 UTC on that day, or `undefined` for text that is no real calendar day. */
export const parseDemoAnchor = (text: string): number | undefined => {
  const match = DAY_PATTERN.exec(text);

  if (match === null) {
    return undefined;
  }

  const [year, month, day] = match.slice(1).map(Number);
  const anchor = Date.UTC(year, month - 1, day, ANCHOR_HOUR_UTC);
  const parsed = new Date(anchor);

  // Date.UTC rolls 2026-02-30 into March, so only a day that survives the round trip is real.
  const isRealDay =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;

  return isRealDay ? anchor : undefined;
};

/**
 * The anchor for `KIKO_DEMO_ANCHOR` when it is set, else the local calendar day
 * of `now`. A malformed override throws, since quietly regenerating for another
 * day would ship a dataset the default view shows empty.
 */
export const resolveDemoAnchor = (override: string | undefined, now: Date): number => {
  if (override === undefined || override === '') {
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), ANCHOR_HOUR_UTC);
  }

  const anchor = parseDemoAnchor(override);

  if (anchor === undefined) {
    throw new Error(
      `KIKO_DEMO_ANCHOR must be a calendar day written YYYY-MM-DD, got "${override}"`,
    );
  }

  return anchor;
};
