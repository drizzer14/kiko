import { StatementParseError } from '../parser';

import { parseDateTimeSeconds } from './parse-date-time';

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
});
