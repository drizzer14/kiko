import { StatementParseError } from '../parser';

import { parseDateTimeSeconds } from './parse-date-time';

describe('parseDateTimeSeconds', () => {
  it('parses a DD.MM.YYYY HH:MM:SS wall clock as Kyiv local time, in UTC seconds since epoch', () => {
    expect(parseDateTimeSeconds('01.07.2025 10:15:00', 'PrivatBank')).toBe(1_751_354_100);
  });

  it('keeps a real 00:00:00 at midnight Kyiv, never noon', () => {
    expect(parseDateTimeSeconds('15.09.2026 00:00:00', 'Monobank')).toBe(
      Date.UTC(2026, 8, 14, 21, 0, 0) / 1000,
    );
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
