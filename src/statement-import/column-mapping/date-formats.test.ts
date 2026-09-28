import { dateFormatIds, dateFormatExamples, parseDateWithFormat } from './date-formats';

describe('dateFormatIds', () => {
  it('lists exactly the 8 presets in order', () => {
    expect(dateFormatIds).toEqual([
      'DD.MM.YYYY HH:MM:SS',
      'DD.MM.YYYY HH:MM',
      'DD.MM.YYYY',
      'DD.MM.YY HH:MM',
      'YYYY-MM-DD HH:MM:SS',
      'YYYY-MM-DD',
      'MM/DD/YYYY',
      'DD/MM/YYYY',
    ]);
  });
});

// The date-format picker shows a worked example instead of the raw preset
// id — self-verified by parsing each example back through its
// OWN format, so a typo'd example can never silently drift from what its
// format id actually accepts.
describe('dateFormatExamples', () => {
  it('gives exactly one example per dateFormatIds entry', () => {
    expect(Object.keys(dateFormatExamples).sort()).toEqual([...dateFormatIds].sort());
  });

  it('every example round-trips through parseDateWithFormat under its own id, resolving to 31 Dec 2026', () => {
    for (const id of dateFormatIds) {
      const seconds = parseDateWithFormat(dateFormatExamples[id], id);

      expect(seconds).toBeDefined();
      expect(new Date((seconds ?? 0) * 1000).getUTCFullYear()).toBe(2026);
      expect(new Date((seconds ?? 0) * 1000).getUTCMonth()).toBe(11);
      expect(new Date((seconds ?? 0) * 1000).getUTCDate()).toBe(31);
    }
  });

  it('never shows the raw preset id verbatim as its own example', () => {
    for (const id of dateFormatIds) {
      expect(dateFormatExamples[id]).not.toBe(id);
    }
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

  it('parses DD/MM/YYYY as UTC midnight seconds', () => {
    expect(parseDateWithFormat('01/07/2025', 'DD/MM/YYYY')).toBe(1_751_328_000);
  });

  it('rejects a DD/MM/YYYY mismatch', () => {
    expect(parseDateWithFormat('2025-07-01', 'DD/MM/YYYY')).toBeUndefined();
  });

  it('trims surrounding whitespace before matching', () => {
    expect(parseDateWithFormat('  01.07.2025 10:15:00  ', 'DD.MM.YYYY HH:MM:SS')).toBe(
      1_751_364_900,
    );
  });

  it('accepts a numeric cell by stringifying it first', () => {
    expect(parseDateWithFormat(20_250_701, 'YYYY-MM-DD')).toBeUndefined();
  });

  // Every preset's own components must survive the round trip through
  // Date.UTC, the same rollover guard `parseLocalDate` (`src/dates/format.ts`)
  // already applies to a local-midnight day — otherwise an out-of-range
  // component (a day past its month's length, an hour/minute past 23/59)
  // silently rolls into a DIFFERENT, wrong calendar instant instead of
  // failing as a recoverable row error.
  describe('rollover rejection — an out-of-range component must not silently roll into another date', () => {
    it('rejects 31.02.2026 (February has no 31st) under DD.MM.YYYY', () => {
      expect(parseDateWithFormat('31.02.2026', 'DD.MM.YYYY')).toBeUndefined();
    });

    it('rejects 31.02.2026 10:00 (February has no 31st) under DD.MM.YYYY HH:MM', () => {
      expect(parseDateWithFormat('31.02.2026 10:00', 'DD.MM.YYYY HH:MM')).toBeUndefined();
    });

    it('rejects 31.02.2026 10:00:00 (February has no 31st) under DD.MM.YYYY HH:MM:SS', () => {
      expect(parseDateWithFormat('31.02.2026 10:00:00', 'DD.MM.YYYY HH:MM:SS')).toBeUndefined();
    });

    it('rejects 31.02.26 10:00 (February has no 31st) under DD.MM.YY HH:MM', () => {
      expect(parseDateWithFormat('31.02.26 10:00', 'DD.MM.YY HH:MM')).toBeUndefined();
    });

    it('rejects 2026-13-45 (month 13, day 45) under YYYY-MM-DD', () => {
      expect(parseDateWithFormat('2026-13-45', 'YYYY-MM-DD')).toBeUndefined();
    });

    it('rejects 2026-13-45 10:00:00 (month 13, day 45) under YYYY-MM-DD HH:MM:SS', () => {
      expect(parseDateWithFormat('2026-13-45 10:00:00', 'YYYY-MM-DD HH:MM:SS')).toBeUndefined();
    });

    it('rejects 25/01/2026 (month 25) under MM/DD/YYYY — a DD/MM file misread as MM/DD', () => {
      expect(parseDateWithFormat('25/01/2026', 'MM/DD/YYYY')).toBeUndefined();
    });

    it('rejects 25/13/2026 (month 13) under DD/MM/YYYY', () => {
      expect(parseDateWithFormat('25/13/2026', 'DD/MM/YYYY')).toBeUndefined();
    });

    it('rejects an out-of-range hour/minute (15.09.2026 25:99) under DD.MM.YYYY HH:MM', () => {
      expect(parseDateWithFormat('15.09.2026 25:99', 'DD.MM.YYYY HH:MM')).toBeUndefined();
    });
  });
});
