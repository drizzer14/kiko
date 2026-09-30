import { DAY_MS, endOfLocalDay, startOfLocalDay } from '@kiko/dates';

// Semgrep fixture (POSITIVE): kiko-no-fixed-day-offset-into-local-day. A local
// day is 23 or 25 hours across DST, so a fixed day span added BEFORE taking the
// local day can land one calendar day off — see kiko-domain's "Dates".

const DAY = DAY_MS;
const HOUR = 3_600_000;

export const defaultRangeFrom = (now: number): Date =>
  // EXPECT-FINDING
  new Date(startOfLocalDay(now - 30 * DAY_MS));

// EXPECT-FINDING
export const endOfTomorrow = (time: number): number => endOfLocalDay(time + DAY_MS);

// EXPECT-FINDING
export const startOfYesterday = (time: number): number => startOfLocalDay(time - 86_400_000);

// EXPECT-FINDING
export const twoDaysBackPlusAnHour = (time: number): number => startOfLocalDay(time - 2 * DAY + HOUR);

// EXPECT-FINDING
export const startOfTomorrow = (time: number): number => startOfLocalDay(DAY + time);
