import { noonIfMidnight, type WallClockParts, kyivWallClockToUtcMilliseconds } from '@kiko/dates';

import { StatementParseError } from '../parser';

const DATE_TIME_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * Kyiv-local reading of bank wall-clock digits — every dedicated bank format
 * reads its own raw wall clock as Europe/Kyiv local time, never the running
 * device's own zone, so the dedup key a row gets never depends on where the
 * phone is.
 * `00:00:00` means "date only" (a date-only preset, or an XLSX `Date` cell
 * with no time part) and becomes 12:00 Kyiv, so the same calendar day shows
 * from UTC-9 to UTC+12. No separate rollover check here: `noonIfMidnight`
 * only ever touches `hour`, never `year`/`month`/`day`, so
 * `kyivWallClockToUtcMilliseconds`'s own round-trip check (against the
 * noon-substituted parts) rejects an impossible date exactly as it would
 * against the original ones.
 */
export const kyivInstantMillisecondsIfRoundTrips = (parts: WallClockParts): number | undefined =>
  kyivWallClockToUtcMilliseconds(noonIfMidnight(parts));

/**
 * Parses a `DD.MM.YYYY HH:MM:SS` combined wall-clock string — the shared
 * convention Monobank CSV and PrivatBank XLSX both use — into UTC seconds
 * since epoch, deterministic and
 * host-timezone-independent. `formatLabel` (e.g. `'Monobank'`,
 * `'PrivatBank'`) names the source format in the thrown message only, so an
 * unrecognized value still points at which format's row failed to parse.
 * Extracted out of `monobank-csv.format.ts`/`privatbank-xlsx.format.ts`
 * rather than duplicated — every CSV format added later is expected to
 * reuse this too.
 */
export const parseDateTimeSeconds = (raw: string, formatLabel: string): number => {
  const match = DATE_TIME_PATTERN.exec(raw.trim());

  if (!match) {
    throw new StatementParseError(`Unrecognized ${formatLabel} date/time: "${raw}"`);
  }

  const milliseconds = kyivInstantMillisecondsIfRoundTrips({
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
