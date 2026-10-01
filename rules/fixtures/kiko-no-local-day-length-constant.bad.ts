// Semgrep fixture (POSITIVE): `kiko-no-local-day-length-constant` MUST report
// a finding on every pinned line below. The day length has one source,
// `DAY_MS` in `@kiko/dates`; never "fix" this file.

// EXPECT-FINDING
const DAY_MS = 24 * 60 * 60 * 1000;

// EXPECT-FINDING
const DAY = 86_400_000;

// EXPECT-FINDING
export const MS_PER_DAY = 86400000;

// EXPECT-FINDING
const FULL_FETCH_INTERVAL_MS = 1000 * 60 * 60 * 24;

// EXPECT-FINDING
const dayMs = 86_400 * 1000;

// EXPECT-FINDING
const ONE_DAY = 864e5;

// EXPECT-FINDING
const HOURS_DAY = 24 * 3_600_000;

// EXPECT-FINDING
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const cutoff = (time: number): number =>
  // EXPECT-FINDING
  time - 86_400_000;

export const twoDaysBack = (time: number): number =>
  // EXPECT-FINDING
  time - 2 * 86_400_000;

export const spans = [DAY_MS, DAY, dayMs, ONE_DAY, HOURS_DAY, WEEK_MS, FULL_FETCH_INTERVAL_MS];
