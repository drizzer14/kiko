import { formatDate, formatDateTime, formatTime, parseLocalDate } from './format';

describe('formatDate', () => {
  it('formats a Date as zero-padded DD.MM.YYYY', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('05.01.2026');
  });

  it('formats a two-digit day and month without extra padding', () => {
    expect(formatDate(new Date(2026, 10, 23))).toBe('23.11.2026');
  });

  it('accepts a numeric timestamp', () => {
    const timestamp = new Date(2026, 8, 2).getTime();

    expect(formatDate(timestamp)).toBe('02.09.2026');
  });
});

describe('formatDateTime', () => {
  it('formats a Date as zero-padded DD.MM.YYYY HH:mm in 24-hour time', () => {
    expect(formatDateTime(new Date(2026, 0, 5, 9, 3))).toBe('05.01.2026 09:03');
  });

  it('formats afternoon time in 24-hour form', () => {
    expect(formatDateTime(new Date(2026, 11, 31, 23, 59))).toBe('31.12.2026 23:59');
  });

  it('accepts a numeric timestamp', () => {
    const timestamp = new Date(2026, 5, 7, 0, 0).getTime();

    expect(formatDateTime(timestamp)).toBe('07.06.2026 00:00');
  });
});

describe('formatTime', () => {
  it('formats a Date as zero-padded HH:MM in 24-hour time', () => {
    expect(formatTime(new Date(2026, 0, 5, 9, 5))).toBe('09:05');
  });

  it('zero-pads a single-digit hour and minute', () => {
    expect(formatTime(new Date(2026, 5, 7, 3, 7))).toBe('03:07');
  });

  it('renders midnight as 00:00', () => {
    expect(formatTime(new Date(2026, 5, 7, 0, 0))).toBe('00:00');
  });

  it('renders afternoon time in 24-hour form', () => {
    expect(formatTime(new Date(2026, 11, 31, 23, 59))).toBe('23:59');
  });

  it('accepts a numeric timestamp', () => {
    const timestamp = new Date(2026, 8, 2, 14, 30).getTime();

    expect(formatTime(timestamp)).toBe('14:30');
  });
});

describe('parseLocalDate', () => {
  it('parses YYYY-MM-DD to local midnight of that calendar day', () => {
    // Local midnight, not UTC midnight: Date.parse('2026-09-02') would land at
    // 00:00 UTC = 02:00/03:00 local in Kyiv, but the day must read back as the
    // exact typed calendar day at 00:00 local.
    const parsed = parseLocalDate('2026-09-02');
    expect(parsed).toBe(new Date(2026, 8, 2).getTime());
    const asDate = new Date(parsed);
    expect(asDate.getFullYear()).toBe(2026);
    expect(asDate.getMonth()).toBe(8);
    expect(asDate.getDate()).toBe(2);
    expect(asDate.getHours()).toBe(0);
  });

  it('does not match plain Date.parse (which reads the string as UTC midnight)', () => {
    // Guards the fix: in a non-UTC zone the two disagree by the zone offset.
    const offsetMinutes = new Date(2026, 8, 2).getTimezoneOffset();
    if (offsetMinutes !== 0) {
      expect(parseLocalDate('2026-09-02')).not.toBe(Date.parse('2026-09-02'));
    }
  });

  it('returns NaN for a malformed or out-of-range string', () => {
    expect(Number.isNaN(parseLocalDate(''))).toBe(true);
    expect(Number.isNaN(parseLocalDate('not-a-date'))).toBe(true);
    expect(Number.isNaN(parseLocalDate('2026-13-01'))).toBe(true);
    expect(Number.isNaN(parseLocalDate('2026-02-30'))).toBe(true);
  });
});
