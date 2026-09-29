/** A calendar date/time, split into its own components — shared by the Kyiv
 * (`kyiv-wall-clock.ts`) and device-local (`device-wall-clock.ts`) readings,
 * since both validate and shape the exact same digits, just resolve them
 * against a different zone. */
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
 * trusting them. Shared by both zone readers so a genuinely impossible date
 * is rejected identically on either path — a DST gap or repeated hour is a
 * separate, zone-specific concern each reading resolves on its own.
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

/** A wall clock of exactly `00:00:00` means "date only" — a spreadsheet
 * `Date` cell with no time part, a CSV date-only preset, or a legacy stored
 * row that predates real instants — and becomes noon in whichever zone the
 * caller reads it, so the same calendar day shows from UTC-9 to UTC+12. */
export const isMidnightWallClock = (parts: WallClockParts): boolean =>
  parts.hour === 0 && parts.minute === 0 && parts.second === 0;

/** `parts` with `hour` bumped to noon when it's date-only (`isMidnightWallClock`
 * above), unchanged otherwise — shared by every zone reader
 * (`kyivInstantMillisecondsIfRoundTrips`, column mapping's `partsToSeconds`,
 * `rezoneImportTime`) so the same date-only convention applies identically
 * regardless of which zone resolves the result. */
export const noonIfMidnight = (parts: WallClockParts): WallClockParts =>
  isMidnightWallClock(parts) ? { ...parts, hour: 12 } : parts;
