import { DAY_MS } from '@kiko/dates';

// Semgrep fixture (NEGATIVE): `kiko-no-local-day-length-constant` MUST report
// nothing on a day span built from the imported `DAY_MS`, on a sub-day or
// seconds-unit constant, on a timestamp literal that happens to fall on a
// UTC midnight, or on a keyed timestamp of epoch + 1 day in a test fixture
// object.

const WEEK_MS = 7 * DAY_MS;

const HOUR_MS = 60 * 60 * 1000;

const SECONDS_PER_DAY = 60 * 60 * 24;

const NEW_YEAR_2024 = 1704067200000;

const NO_DELAY_MS = 0 * 1000;

const POINTS = [
  { t: 0, amount: 100 },
  { t: 86_400_000, amount: 300 },
];

const STORED_QUOTA = { day: 86_400_000, calls: 3, dailyLimit: 20 };

export const nextDay = (time: number): number => time + DAY_MS;

export const spans = [WEEK_MS, HOUR_MS, SECONDS_PER_DAY, NEW_YEAR_2024, NO_DELAY_MS];

export const fixtures = [POINTS, STORED_QUOTA];
