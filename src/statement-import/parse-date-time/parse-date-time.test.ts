import { StatementParseError } from '../parser';

import { parseDateTimeSeconds, utcMillisecondsIfRoundTrips } from './parse-date-time';

describe('utcMillisecondsIfRoundTrips', () => {
  it('builds the UTC instant for calendar parts that round-trip', () => {
    const parts = { year: 2026, month: 7, day: 1, hour: 10, minute: 15, second: 0 };

    expect(utcMillisecondsIfRoundTrips(parts)).toBe(Date.UTC(2026, 6, 1, 10, 15, 0));
  });

  it('accepts 29 February on a leap year', () => {
    const parts = { year: 2024, month: 2, day: 29, hour: 0, minute: 0, second: 0 };

    expect(utcMillisecondsIfRoundTrips(parts)).toBe(Date.UTC(2024, 1, 29));
  });

  it('rejects a day that rolls over (February has no 31st)', () => {
    const parts = { year: 2026, month: 2, day: 31, hour: 10, minute: 0, second: 0 };

    expect(utcMillisecondsIfRoundTrips(parts)).toBeUndefined();
  });

  it('rejects 29 February on a non-leap year', () => {
    const parts = { year: 2025, month: 2, day: 29, hour: 0, minute: 0, second: 0 };

    expect(utcMillisecondsIfRoundTrips(parts)).toBeUndefined();
  });

  it('rejects an out-of-range hour/minute that rolls over', () => {
    const parts = { year: 2026, month: 9, day: 15, hour: 25, minute: 61, second: 0 };

    expect(utcMillisecondsIfRoundTrips(parts)).toBeUndefined();
  });
});

describe('parseDateTimeSeconds', () => {
  it('parses a DD.MM.YYYY HH:MM:SS wall clock as UTC seconds since epoch', () => {
    expect(parseDateTimeSeconds('01.07.2025 10:15:00', 'PrivatBank')).toBe(1_751_364_900);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(parseDateTimeSeconds('  01.07.2025 10:15:00  ', 'PrivatBank')).toBe(1_751_364_900);
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
