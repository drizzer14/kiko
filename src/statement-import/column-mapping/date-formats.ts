// The fixed set of date presets a user can pick for the column-mapping
// import's date column — one entry per shape actually seen across the
// dedicated bank formats (Monobank/PrivatBank's `DD.MM.YYYY HH:MM:SS`,
// Sensebank's 2-digit-year `DD.MM.YY HH:MM`), plus a few common shorter/ISO
// variants a manually-exported statement might carry instead.
import type { TableCell } from './table-rows';

export const dateFormatIds = [
  'DD.MM.YYYY HH:MM:SS',
  'DD.MM.YYYY HH:MM',
  'DD.MM.YYYY',
  'DD.MM.YY HH:MM',
  'YYYY-MM-DD HH:MM:SS',
  'YYYY-MM-DD',
  'MM/DD/YYYY',
] as const;

export type DateFormatId = (typeof dateFormatIds)[number];

type DatePreset = {
  pattern: RegExp;
  toSeconds: (match: RegExpExecArray) => number;
};

// Every preset reads UTC wall-clock parts — the same `parseDateTimeSeconds`
// convention the dedicated formats use (`../parse-date-time`), never the host
// device's local timezone. `DD.MM.YY HH:MM` maps its 2-digit year to `20YY`,
// matching Sensebank's own dedicated parse exactly (real years past 2099
// never appear in a bank export).
const presets: Record<DateFormatId, DatePreset> = {
  'DD.MM.YYYY HH:MM:SS': {
    pattern: /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/,
    toSeconds: ([, day, month, year, hour, minute, second]) =>
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      ) / 1000,
  },
  'DD.MM.YYYY HH:MM': {
    pattern: /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/,
    toSeconds: ([, day, month, year, hour, minute]) =>
      Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0) /
      1000,
  },
  'DD.MM.YYYY': {
    pattern: /^(\d{2})\.(\d{2})\.(\d{4})$/,
    toSeconds: ([, day, month, year]) =>
      Date.UTC(Number(year), Number(month) - 1, Number(day)) / 1000,
  },
  'DD.MM.YY HH:MM': {
    pattern: /^(\d{2})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})$/,
    toSeconds: ([, day, month, year, hour, minute]) =>
      Date.UTC(
        2000 + Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        0,
      ) / 1000,
  },
  'YYYY-MM-DD HH:MM:SS': {
    pattern: /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
    toSeconds: ([, year, month, day, hour, minute, second]) =>
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      ) / 1000,
  },
  'YYYY-MM-DD': {
    pattern: /^(\d{4})-(\d{2})-(\d{2})$/,
    toSeconds: ([, year, month, day]) =>
      Date.UTC(Number(year), Number(month) - 1, Number(day)) / 1000,
  },
  'MM/DD/YYYY': {
    pattern: /^(\d{2})\/(\d{2})\/(\d{4})$/,
    toSeconds: ([, month, day, year]) =>
      Date.UTC(Number(year), Number(month) - 1, Number(day)) / 1000,
  },
};

/**
 * Parses one date/time cell against a single named preset, returning `undefined`
 * (never throwing) on a mismatch — the column-mapping core surfaces that as a
 * recoverable per-row `'date'` error (`applyColumnMapping`) rather than
 * aborting the whole import, unlike a dedicated format's own
 * `parseDateTimeSeconds`, which throws because its shape is fixed and known
 * in advance.
 */
export const parseDateWithFormat = (raw: TableCell, id: DateFormatId): number | undefined => {
  const preset = presets[id];
  const match = preset.pattern.exec(String(raw).trim());

  return match ? preset.toSeconds(match) : undefined;
};
