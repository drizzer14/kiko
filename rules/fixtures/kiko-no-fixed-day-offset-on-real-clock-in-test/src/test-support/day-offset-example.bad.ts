// Semgrep fixture (POSITIVE, NESTED): kiko-no-fixed-day-offset-on-real-clock-in-test
// carries a path-prefixed `paths.include` entry (`src/test-support/**`), which
// draws NOTHING against a fixture placed directly in rules/fixtures/
// (kiko-linter's "Semgrep facts" gotcha), so this fixture mirrors a real
// src/test-support/ path instead.
import { DAY_MS, startOfLocalDay } from '@kiko/dates';

const DAY = 86_400_000;
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
