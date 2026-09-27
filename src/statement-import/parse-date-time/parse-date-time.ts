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

  const [, day, month, year, hour, minute, second] = match;

  return (
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ) / 1000
  );
};
