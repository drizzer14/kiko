import { dateFormatIds, parseDateWithFormat } from './date-formats';

describe('dateFormatIds', () => {
  it('lists exactly the 7 presets in order', () => {
    expect(dateFormatIds).toEqual([
      'DD.MM.YYYY HH:MM:SS',
      'DD.MM.YYYY HH:MM',
      'DD.MM.YYYY',
      'DD.MM.YY HH:MM',
      'YYYY-MM-DD HH:MM:SS',
      'YYYY-MM-DD',
      'MM/DD/YYYY',
    ]);
  });
});

describe('parseDateWithFormat', () => {
  it('parses DD.MM.YYYY HH:MM:SS as UTC seconds', () => {
    expect(parseDateWithFormat('01.07.2025 10:15:00', 'DD.MM.YYYY HH:MM:SS')).toBe(1_751_364_900);
  });

  it('rejects a DD.MM.YYYY HH:MM:SS mismatch', () => {
    expect(parseDateWithFormat('01.07.2025', 'DD.MM.YYYY HH:MM:SS')).toBeUndefined();
  });

  it('parses DD.MM.YYYY HH:MM as UTC seconds', () => {
    expect(parseDateWithFormat('01.07.2025 10:15', 'DD.MM.YYYY HH:MM')).toBe(1_751_364_900);
  });

  it('rejects a DD.MM.YYYY HH:MM mismatch', () => {
    expect(parseDateWithFormat('01.07.2025 10:15:00', 'DD.MM.YYYY HH:MM')).toBeUndefined();
  });

  it('parses DD.MM.YYYY as UTC midnight seconds', () => {
    expect(parseDateWithFormat('01.07.2025', 'DD.MM.YYYY')).toBe(1_751_328_000);
  });

  it('rejects a DD.MM.YYYY mismatch', () => {
    expect(parseDateWithFormat('2025-07-01', 'DD.MM.YYYY')).toBeUndefined();
  });

  it('parses DD.MM.YY HH:MM with a two-digit year as 20YY (Sensebank convention)', () => {
    expect(parseDateWithFormat('09.01.00 00:58', 'DD.MM.YY HH:MM')).toBe(947_379_480);
  });

  it('rejects a DD.MM.YY HH:MM mismatch', () => {
    expect(parseDateWithFormat('09.01.2000 00:58', 'DD.MM.YY HH:MM')).toBeUndefined();
  });

  it('parses YYYY-MM-DD HH:MM:SS as UTC seconds', () => {
    expect(parseDateWithFormat('2025-07-01 10:15:00', 'YYYY-MM-DD HH:MM:SS')).toBe(1_751_364_900);
  });

  it('rejects a YYYY-MM-DD HH:MM:SS mismatch', () => {
    expect(parseDateWithFormat('01.07.2025 10:15:00', 'YYYY-MM-DD HH:MM:SS')).toBeUndefined();
  });

  it('parses YYYY-MM-DD as UTC midnight seconds', () => {
    expect(parseDateWithFormat('2025-07-01', 'YYYY-MM-DD')).toBe(1_751_328_000);
  });

  it('rejects a YYYY-MM-DD mismatch', () => {
    expect(parseDateWithFormat('01.07.2025', 'YYYY-MM-DD')).toBeUndefined();
  });

  it('parses MM/DD/YYYY as UTC midnight seconds', () => {
    expect(parseDateWithFormat('07/01/2025', 'MM/DD/YYYY')).toBe(1_751_328_000);
  });

  it('rejects a MM/DD/YYYY mismatch', () => {
    expect(parseDateWithFormat('2025-07-01', 'MM/DD/YYYY')).toBeUndefined();
  });

  it('trims surrounding whitespace before matching', () => {
    expect(parseDateWithFormat('  01.07.2025 10:15:00  ', 'DD.MM.YYYY HH:MM:SS')).toBe(
      1_751_364_900,
    );
  });

  it('accepts a numeric cell by stringifying it first', () => {
    expect(parseDateWithFormat(20_250_701, 'YYYY-MM-DD')).toBeUndefined();
  });
});
