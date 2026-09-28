import {
  isMidnightWallClock,
  isRealCalendarInstant,
  kyivWallClockToUtcMilliseconds,
  type WallClockParts,
} from '@kiko/dates';

import { StatementParseError } from '../parser';

const DATE_TIME_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

/** A calendar date/time, split into its own components — `month` is
 * 1-based, matching how every caller reads it straight off a regex match. */
type DateTimeParts = WallClockParts;

/**
 * Kyiv-local reading of bank wall-clock digits — every dedicated bank format
 * reads its own raw wall clock as Europe/Kyiv local time, never the running
 * device's own zone (that reading is column mapping's own
 * `deviceWallClockToLocalMilliseconds`, `column-mapping/date-formats.ts`).
 * `00:00:00` means "date only" (a date-only preset, or an XLSX `Date` cell
 * with no time part) and becomes 12:00 Kyiv, so the same calendar day shows
 * from UTC-9 to UTC+12. The rollover check runs on the ORIGINAL parts first,
 * before the noon substitution, so an impossible date is rejected on its own
 * terms either way.
 */
export const kyivInstantMillisecondsIfRoundTrips = (parts: DateTimeParts): number | undefined => {
  if (!isRealCalendarInstant(parts)) {
    return undefined;
  }

  return kyivWallClockToUtcMilliseconds(
    isMidnightWallClock(parts) ? { ...parts, hour: 12 } : parts,
  );
};

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
