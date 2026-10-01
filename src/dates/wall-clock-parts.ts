/** A calendar date/time, split into its own components, before any zone
 * resolves it (`zone-wall-clock.ts`). */
export type WallClockParts = {
  year: number;
  month: number; // 1-based
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/**
 * Whether `parts` describes a real calendar/time instant at all, independent
 * of any timezone: `Date.UTC` silently NORMALIZES an out-of-range day
 * ("31.02"), month, hour, minute, or second into a DIFFERENT, wrong instant
 * instead of rejecting it, so this builds the instant through `Date.UTC` and
 * checks its own UTC getters reproduce the exact input digits before
 * trusting them. A DST gap or repeated hour is a separate, zone-specific
 * concern the zone reader resolves on its own.
 */
export const isRealCalendarInstant = ({
  year,
  month,
  day,
  hour,
  minute,
  second,
}: WallClockParts): boolean => {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
};

/** A stored instant's own UTC calendar/time digits, as parts — the legacy
 * "wall clock written as if it were UTC" convention a rezone step reads a
 * legacy row through (`rezoneImportTime`), and the shift-then-read step of
 * `zoneWallClockOf`. */
export const utcDigitsOf = (milliseconds: number): WallClockParts => {
  const date = new Date(milliseconds);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
};

/** Whether a wall clock is exactly `00:00:00`. A source that cannot tell a
 * date-only value from a real midnight (a spreadsheet `Date` cell,
 * `table-rows.ts`) reads it as date-only. `mapping.ts`'s `noonAliasDedupKey`
 * also asks it of a timed row's Kyiv wall clock, to find the real midnight an
 * older build stored at noon. */
export const isMidnightWallClock = (parts: WallClockParts): boolean =>
  parts.hour === 0 && parts.minute === 0 && parts.second === 0;

/** `parts` with `hour` bumped to noon when it's midnight (`isMidnightWallClock`
 * above), unchanged otherwise, so a Kyiv date-only day shows as the same
 * calendar day from UTC-9 to UTC+13:45. Callers: a legacy stored row's rezone
 * (`plan-import-time-rezone.ts`), and `mapping.ts`'s `noonAliasDedupKey`. */
export const noonIfMidnight = (parts: WallClockParts): WallClockParts =>
  isMidnightWallClock(parts) ? { ...parts, hour: 12 } : parts;
