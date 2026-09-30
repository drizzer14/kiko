// Semgrep fixture (POSITIVE, NESTED): kiko-no-fixed-day-offset-on-real-clock-in-test
// carries a path-prefixed `paths.include` entry (`src/test-support/**`), which
// draws NOTHING against a fixture placed directly in rules/fixtures/
// (kiko-linter's "Semgrep facts" gotcha), so this fixture mirrors a real
// src/test-support/ path instead.
import { DAY_MS, startOfLocalDay } from '@kiko/dates';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const now = Date.now();

// EXPECT-FINDING
export const tomorrow = (): number => Date.now() + DAY_MS;

// EXPECT-FINDING
export const twoDaysAgo = (): number => Date.now() - 2 * 24 * 60 * 60 * 1000;

// EXPECT-FINDING
export const tomorrowFromLiteral = (): number => 86_400_000 + Date.now();

export const fixtureDays = (): number[] => [
  // EXPECT-FINDING
  now - DAY,
  // EXPECT-FINDING
  now + 3 * DAY,
  // EXPECT-FINDING
  now + HOUR + DAY,
];

// EXPECT-FINDING
export const tomorrowAndAnHour = (): number => Date.now() + HOUR + DAY_MS;

// EXPECT-FINDING
export const yesterdayBySpelledSpan = (): number => Date.now() - 1000 * 60 * 60 * 24;

// EXPECT-FINDING
export const tomorrowFromDateObject = (): number => new Date().getTime() + DAY_MS;

// EXPECT-FINDING
export const yesterdayLessAnHour = (): number => new Date().getTime() - HOUR - DAY_MS;

export const dayNamedSpans = (dayMs: number, msPerDay: number, days: number): number[] => [
  // EXPECT-FINDING
  Date.now() + dayMs,
  // EXPECT-FINDING
  Date.now() - msPerDay,
  // EXPECT-FINDING
  Date.now() + days * 24 * HOUR,
];

export const startOfTomorrow = (): number =>
  // EXPECT-FINDING
  startOfLocalDay(Date.now() + DAY_MS);

export const advanceClock = (): number => {
  let clock = Date.now();
  // EXPECT-FINDING
  clock += 31 * DAY_MS;

  return clock;
};
