import { utcDigitsOf, isRealCalendarInstant, type WallClockParts } from './wall-clock-parts';

/**
 * A source time zone's wall-clock rule, hand-rolled instead of `Intl`:
 * Hermes' `Intl` timeZone support is unverified on device, and Jest runs
 * Node's own ICU, so a green test through `Intl` would prove nothing about
 * the device. `europeanSummerTime` is the EU rule Ukraine follows too: one
 * hour more from the last Sunday of March to the last Sunday of October,
 * both switches at 01:00 UTC, valid from 1996 onward.
 */
export type ZoneRule = {
  standardOffsetMinutes: number;
  europeanSummerTime: boolean;
};

const MINUTE_MILLISECONDS = 60_000;

const lastSundayOf = (year: number, monthIndex: number): number => {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));

  return lastDay.getUTCDate() - lastDay.getUTCDay();
};

const summerTimeBoundsUtc = (year: number): { from: number; until: number } => ({
  from: Date.UTC(year, 2, lastSundayOf(year, 2), 1),
  until: Date.UTC(year, 9, lastSundayOf(year, 9), 1),
});

/**
 * The rule's offset east of UTC, in minutes, for a wall clock in that zone.
 * The summer bounds are shifted onto the wall clock by the summer offset, so
 * a spring-gap wall clock (the hour that never happens) reads as standard
 * time (forward, matching how the JS `Date` constructor resolves an
 * out-of-range field), and an autumn repeated hour reads as summer time, the
 * earlier of its two real instants.
 */
export const zoneOffsetMinutes = (rule: ZoneRule, parts: WallClockParts): number => {
  if (!rule.europeanSummerTime) {
    return rule.standardOffsetMinutes;
  }

  const { year, month, day, hour, minute, second } = parts;
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const summerOffsetMilliseconds = (rule.standardOffsetMinutes + 60) * MINUTE_MILLISECONDS;
  const { from, until } = summerTimeBoundsUtc(year);
  const isSummer = wall >= from + summerOffsetMilliseconds && wall < until + summerOffsetMilliseconds;

  return rule.standardOffsetMinutes + (isSummer ? 60 : 0);
};

/**
 * The UTC instant (milliseconds since epoch) for a wall clock in the rule's
 * zone, or `undefined` when the digits don't describe a real calendar instant
 * at all (`isRealCalendarInstant`).
 */
export const zoneWallClockToUtcMilliseconds = (
  rule: ZoneRule,
  parts: WallClockParts,
): number | undefined => {
  if (!isRealCalendarInstant(parts)) {
    return undefined;
  }

  const { year, month, day, hour, minute, second } = parts;
  const wallMilliseconds = Date.UTC(year, month - 1, day, hour, minute, second);

  return wallMilliseconds - zoneOffsetMinutes(rule, parts) * MINUTE_MILLISECONDS;
};

/** The wall clock an instant shows in the rule's zone. */
export const zoneWallClockOf = (rule: ZoneRule, milliseconds: number): WallClockParts => {
  const { from, until } = summerTimeBoundsUtc(new Date(milliseconds).getUTCFullYear());
  const isSummer = rule.europeanSummerTime && milliseconds >= from && milliseconds < until;
  const offsetMinutes = rule.standardOffsetMinutes + (isSummer ? 60 : 0);

  return utcDigitsOf(milliseconds + offsetMinutes * MINUTE_MILLISECONDS);
};
