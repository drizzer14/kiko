import { kyivWallClockToUtcMilliseconds } from '@kiko/dates';

import { StatementParseError } from '../parser';

const DATE_TIME_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * Parses a `DD.MM.YYYY HH:MM:SS` combined wall-clock string — the shared
 * convention Monobank CSV and PrivatBank XLSX both use — into UTC seconds
 * since epoch, read as Europe/Kyiv time, never the running device's own
 * zone, so the dedup key a row gets never depends on where the phone is. The
 * string always carries a real time, so an exact `00:00:00` stays midnight:
 * read as a date-only noon it would outrank a later row on the same day.
 * `formatLabel` (e.g. `'Monobank'`, `'PrivatBank'`) names the source format
 * in the thrown message only, so an unrecognized value still points at which
 * format's row failed to parse. Extracted out of
 * `monobank-csv.format.ts`/`privatbank-xlsx.format.ts` rather than
 * duplicated — every CSV format added later is expected to reuse this too.
 */
export const parseDateTimeSeconds = (raw: string, formatLabel: string): number => {
  const match = DATE_TIME_PATTERN.exec(raw.trim());

  if (!match) {
    throw new StatementParseError(`Unrecognized ${formatLabel} date/time: "${raw}"`);
  }

  const milliseconds = kyivWallClockToUtcMilliseconds({
    year: Number(match[3]),
    month: Number(match[2]),
    day: Number(match[1]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
  });

  if (milliseconds === undefined) {
    throw new StatementParseError(`Unrecognized ${formatLabel} date/time: "${raw}"`);
  }

  return milliseconds / 1000;
};
