import type { WallClockParts } from './wall-clock-parts';
import { type ZoneRule, zoneWallClockToUtcMilliseconds } from './zone-wall-clock';

/**
 * Europe/Kyiv: UTC+2, with EU summer time (`zone-wall-clock.ts`). A 2024
 * Rada bill to abolish DST has not been signed as of this writing; if it
 * ever is, this is the one place to update, with an effective date guard.
 */
export const KYIV_ZONE_RULE: ZoneRule = { standardOffsetMinutes: 120, europeanSummerTime: true };

/**
 * The UTC instant (milliseconds since epoch) for a Europe/Kyiv wall clock, or
 * `undefined` when the digits don't describe a real calendar instant at all.
 */
export const kyivWallClockToUtcMilliseconds = (parts: WallClockParts): number | undefined =>
  zoneWallClockToUtcMilliseconds(KYIV_ZONE_RULE, parts);
