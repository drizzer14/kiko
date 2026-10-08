// Semgrep fixture (NEGATIVE): reads the wall clock through the project's own
// Kyiv zone reading, never `Date.UTC`/the local-time `new Date(year, month,
// ...)` constructor. `kiko-no-date-utc-in-statement-import` MUST report
// nothing here.
import { kyivWallClockToUtcMilliseconds } from '@kiko/dates';

export const fixtureGoodWallClockMilliseconds = (): number | undefined =>
  kyivWallClockToUtcMilliseconds({
    year: 2026,
    month: 9,
    day: 15,
    hour: 22,
    minute: 30,
    second: 0,
  });
