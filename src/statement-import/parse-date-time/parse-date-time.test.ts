import { StatementParseError } from '../parser';

import { kyivInstantMillisecondsIfRoundTrips, parseDateTimeSeconds } from './parse-date-time';

const parts = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
) => ({ year, month, day, hour, minute, second });

describe('kyivInstantMillisecondsIfRoundTrips', () => {
  it('reads a summer evening wall clock as Kyiv local time', () => {
    expect(kyivInstantMillisecondsIfRoundTrips(parts(2026, 9, 15, 22, 30, 0))).toBe(
      Date.UTC(2026, 8, 15, 19, 30, 0),
    );
  });

  it('reads a winter evening wall clock as Kyiv local time', () => {
    expect(kyivInstantMillisecondsIfRoundTrips(parts(2026, 1, 15, 22, 30, 0))).toBe(
      Date.UTC(2026, 0, 15, 20, 30, 0),
    );
  });

  it('treats an exact 00:00:00 as date-only and reads it as noon Kyiv', () => {
    expect(kyivInstantMillisecondsIfRoundTrips(parts(2026, 9, 15, 0, 0, 0))).toBe(
      Date.UTC(2026, 8, 15, 9, 0, 0),
    );
  });

  it('rejects a day that rolls over (February has no 31st)', () => {
    expect(kyivInstantMillisecondsIfRoundTrips(parts(2026, 2, 31, 10, 0))).toBeUndefined();
  });

  it('rejects an impossible date even at exact midnight — the noon substitution does not rescue it', () => {
    expect(kyivInstantMillisecondsIfRoundTrips(parts(2026, 2, 31, 0, 0, 0))).toBeUndefined();
  });

  it('rejects an out-of-range hour/minute that rolls over', () => {
    expect(kyivInstantMillisecondsIfRoundTrips(parts(2026, 9, 15, 25, 61))).toBeUndefined();
  });
});

describe('parseDateTimeSeconds', () => {
  it('parses a DD.MM.YYYY HH:MM:SS wall clock as Kyiv local time, in UTC seconds since epoch', () => {
    expect(parseDateTimeSeconds('01.07.2025 10:15:00', 'PrivatBank')).toBe(1_751_354_100);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(parseDateTimeSeconds('  01.07.2025 10:15:00  ', 'PrivatBank')).toBe(1_751_354_100);
  });

  it('throws a StatementParseError naming the format label for an unparseable value', () => {
    expect(() => parseDateTimeSeconds('not-a-date', 'Monobank')).toThrow(StatementParseError);
    expect(() => parseDateTimeSeconds('not-a-date', 'Monobank')).toThrow(/Monobank/);
  });

  it('includes the raw unparsed value in the thrown message', () => {
    expect(() => parseDateTimeSeconds('31/12/2025 10:00:00', 'PrivatBank')).toThrow(
      /31\/12\/2025 10:00:00/,
    );
  });

  // The shape matches (two digits per field) but the calendar instant does
  // not exist — `Date.UTC` would otherwise silently roll it into a DIFFERENT
  // date instead of failing, same rollover guard as `date-formats.ts`'s
  // `partsToSeconds` (column-mapping's own preset parser).
  it('throws for a day that rolls over (February has no 31st)', () => {
    expect(() => parseDateTimeSeconds('31.02.2026 10:00:00', 'PrivatBank')).toThrow(
      StatementParseError,
    );
  });

  it('throws for an out-of-range hour/minute that rolls over', () => {
    expect(() => parseDateTimeSeconds('15.09.2026 25:61:00', 'Monobank')).toThrow(
      StatementParseError,
    );
  });
});
