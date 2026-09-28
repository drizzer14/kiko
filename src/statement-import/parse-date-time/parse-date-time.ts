import { StatementParseError } from '../parser';

const DATE_TIME_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

/** A calendar date/time, split into its own components — `month` is
 * 1-based, matching how every caller reads it straight off a regex match. */
export type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/**
 * Builds the UTC instant (milliseconds since epoch) for calendar/time PARTS,
 * or `undefined` when they don't describe a real one. `Date.UTC` silently
 * NORMALIZES an out-of-range component — an impossible day ("31.02.2026"),
 * month, hour, or minute — into a DIFFERENT, wrong instant instead of
 * rejecting it, so every bank-export date/time parser in this project builds
 * the instant through this helper and checks the constructed date's own UTC
 * getters reproduce the exact parsed components before trusting it, rather
 * than hand-rolling the same round-trip check per format.
 */
export const utcMillisIfRoundTrips = (parts: DateTimeParts): number | undefined => {
  const { year, month, day, hour, minute, second } = parts;
  const milliseconds = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(milliseconds);
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;

  return roundTrips ? milliseconds : undefined;
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

  const milliseconds = utcMillisIfRoundTrips({
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
