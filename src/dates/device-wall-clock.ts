import { isRealCalendarInstant, type WallClockParts } from './wall-clock-parts';

/**
 * The instant (milliseconds since epoch) for wall-clock PARTS read in THIS
 * DEVICE's own local time zone — the manual column-mapping import path's
 * reading (never Kyiv's — see `kyiv-wall-clock.ts`), since a user-mapped file
 * the app has no dedicated bank parser for could be from any bank, in any
 * zone. No `Intl`: the JS local-time `Date` constructor already carries the
 * device's own zone rules, the same constructor `local-day.ts`'s
 * `startOfLocalDay`/`endOfLocalDay` already use for a DST-correct local day
 * boundary.
 *
 * The digits are validated FIRST, independent of any zone
 * (`isRealCalendarInstant`, shared with the Kyiv reading) — an impossible
 * day ("31.02"), hour, or minute is rejected the same way on both paths.
 * Once the digits are calendar-real, the local constructor's own DST
 * resolution is accepted as-is, never re-checked against it: a
 * spring-forward gap wall clock (a real calendar time this device's own zone
 * skips once a year) maps FORWARD to the next real instant, and an autumn
 * repeated-hour wall clock resolves to whichever of its two real instants
 * this JS engine's own local-time constructor picks — both are the engine's
 * native behavior, not a rule enforced here.
 */
export const deviceWallClockToLocalMilliseconds = (parts: WallClockParts): number | undefined => {
  if (!isRealCalendarInstant(parts)) {
    return undefined;
  }

  const { year, month, day, hour, minute, second } = parts;

  return new Date(year, month - 1, day, hour, minute, second).getTime();
};
