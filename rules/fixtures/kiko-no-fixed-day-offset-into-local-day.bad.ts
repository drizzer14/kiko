import { DAY_MS, endOfLocalDay, startOfLocalDay } from '@kiko/dates';

// Semgrep fixture (POSITIVE): kiko-no-fixed-day-offset-into-local-day. A local
// day is 23 or 25 hours across DST, so a fixed day span added BEFORE taking the
// local day can land one calendar day off — see kiko-domain's "Dates".

const DAY = DAY_MS;
const HOUR = 3_600_000;
const dayMs = DAY_MS;
const msPerDay = DAY_MS;
const ONE_DAY_MS = DAY_MS;
const THIRTY_DAYS_MS = 30 * DAY_MS;

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

// EXPECT-FINDING
export const threeDaysBack = (time: number): number => startOfLocalDay(time - 3 * dayMs);

// EXPECT-FINDING
export const yesterdayByProduct = (time: number): number => startOfLocalDay(time - 1000 * 60 * 60 * 24);

// EXPECT-FINDING
export const endOfNextDay = (time: number): number => endOfLocalDay(time + msPerDay);

// EXPECT-FINDING
export const oneDayBack = (time: number): number => startOfLocalDay(time - ONE_DAY_MS);

// EXPECT-FINDING
export const thirtyDaysBack = (time: number): number => startOfLocalDay(time - THIRTY_DAYS_MS);
