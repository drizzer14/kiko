/** A calendar date/time, split into its own components, before any zone
 * resolves it (`kyiv-wall-clock.ts`). */
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

/** A wall clock of exactly `00:00:00`, from a source that cannot tell a
 * date-only value from a real midnight — a spreadsheet `Date` cell, or a
 * legacy stored row that predates real instants — is read as date-only. A
 * source that carries a real time (a timed text cell) never comes here. */
export const isMidnightWallClock = (parts: WallClockParts): boolean =>
  parts.hour === 0 && parts.minute === 0 && parts.second === 0;

/** `parts` with `hour` bumped to noon when it's date-only (`isMidnightWallClock`
 * above), unchanged otherwise, so the same calendar day shows from UTC-9 to
 * UTC+12 (`table-rows.ts`'s spreadsheet `Date` cell, `rezoneImportTime`). */
export const noonIfMidnight = (parts: WallClockParts): WallClockParts =>
  isMidnightWallClock(parts) ? { ...parts, hour: 12 } : parts;
