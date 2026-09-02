import { formatDate, formatDateTime } from './format';

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
