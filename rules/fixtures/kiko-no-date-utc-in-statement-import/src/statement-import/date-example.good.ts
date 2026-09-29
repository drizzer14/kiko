// Semgrep fixture (NEGATIVE): reads the wall clock through the project's own
// zone helpers, never `Date.UTC`/the local-time `new Date(year, month, ...)`
// constructor. `kiko-no-date-utc-in-statement-import` MUST report nothing
// here.
import { kyivInstantMillisecondsIfRoundTrips } from '@kiko/statement-import/parse-date-time';

export const fixtureGoodWallClockMilliseconds = (): number | undefined =>
  kyivInstantMillisecondsIfRoundTrips({
    year: 2026,
    month: 9,
    day: 15,
    hour: 22,
    minute: 30,
    second: 0,
  });
