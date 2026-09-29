import { isRealCalendarInstant, type WallClockParts } from './wall-clock-parts';

/**
 * Europe/Kyiv wall-clock <-> UTC conversion, hand-rolled instead of `Intl`:
 * Hermes' `Intl` timeZone support is unverified on device, and Jest runs
 * Node's own ICU, so a green test through `Intl` would prove nothing about
 * the device. Ukraine follows the EU DST rule (last Sunday of March/October,
 * 01:00 UTC), valid from 1996 onward — every bank this project reads
 * statements from postdates that. A 2024 Rada bill to abolish DST has not
 * been signed as of this writing; if it ever is, this is the one place to
 * update, with an effective date guard alongside `kyivOffsetHours`.
 */

const lastSundayOf = (year: number, monthIndex: number): number => {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));

  return lastDay.getUTCDate() - lastDay.getUTCDay();
};

/**
 * +3 from the last Sunday of March 04:00 UTC (01:00 Kyiv, hence the wall-clock
 * boundary below reads 04:00) to the last Sunday of October 04:00 UTC,
 * otherwise +2. A spring-gap wall clock (03:00-03:59, which never happens)
 * reads as +2 (forward, matching how the JS `Date` constructor itself
 * resolves an out-of-range field); an autumn repeated hour (03:00-03:59,
 * which happens twice) reads as +3, the earlier of the two real instants.
 */
export const kyivOffsetHours = ({
  year,
  month,
  day,
  hour,
  minute,
  second,
}: WallClockParts): 2 | 3 => {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const summerFrom = Date.UTC(year, 2, lastSundayOf(year, 2), 4);
  const summerUntil = Date.UTC(year, 9, lastSundayOf(year, 9), 4);

  return wall >= summerFrom && wall < summerUntil ? 3 : 2;
};

/**
 * The UTC instant (milliseconds since epoch) for a Europe/Kyiv wall clock, or
 * `undefined` when the digits don't describe a real calendar instant at all
 * (`isRealCalendarInstant`, shared with the device reading below).
 */
export const kyivWallClockToUtcMilliseconds = (parts: WallClockParts): number | undefined => {
  if (!isRealCalendarInstant(parts)) {
    return undefined;
  }

  const { year, month, day, hour, minute, second } = parts;
  const wallMilliseconds = Date.UTC(year, month - 1, day, hour, minute, second);

  return wallMilliseconds - kyivOffsetHours(parts) * 3_600_000;
};

/** Reads a stored instant's own UTC calendar/time digits back as parts — the
 * legacy "wall clock written as if it were UTC" convention every stored
 * import row used before this change, and the one a rezone step reads a
 * legacy row through (`rezoneImportTime`). */
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
