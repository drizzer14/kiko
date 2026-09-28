import { StatementParseError } from '../parser';

const DATE_TIME_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

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

  const parsedYear = Number(match[3]);
  const parsedMonthIndex = Number(match[2]) - 1;
  const parsedDay = Number(match[1]);
  const parsedHour = Number(match[4]);
  const parsedMinute = Number(match[5]);
  const parsedSecond = Number(match[6]);
  const ms = Date.UTC(
    parsedYear,
    parsedMonthIndex,
    parsedDay,
    parsedHour,
    parsedMinute,
    parsedSecond,
  );
  const date = new Date(ms);
  // Reject rollover (e.g. 31.02.2026, or an hour/minute past 23/59): `Date.UTC`
  // normalizes an out-of-range component into a DIFFERENT, wrong instant
  // instead of rejecting it — the round-trip components must survive
  // unchanged, the same guard `date-formats.ts`'s `partsToSeconds` applies for
  // column-mapping's own preset parser.
  const roundTrips =
    date.getUTCFullYear() === parsedYear &&
    date.getUTCMonth() === parsedMonthIndex &&
    date.getUTCDate() === parsedDay &&
    date.getUTCHours() === parsedHour &&
    date.getUTCMinutes() === parsedMinute &&
    date.getUTCSeconds() === parsedSecond;

  if (!roundTrips) {
    throw new StatementParseError(`Unrecognized ${formatLabel} date/time: "${raw}"`);
  }

  return ms / 1000;
};
