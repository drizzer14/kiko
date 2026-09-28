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
  'DD/MM/YYYY',
] as const;

export type DateFormatId = (typeof dateFormatIds)[number];

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type DatePreset = {
  pattern: RegExp;
  toParts: (match: RegExpExecArray) => DateParts;
};

// Builds UTC seconds from parsed date/time PARTS, rejecting a rollover — an
// out-of-range day ("31.02.2026"), month ("2026-13-45"), hour, or minute
// silently rolling into a DIFFERENT, wrong calendar instant (`Date.UTC`
// normalizes every component instead of validating it) rather than failing
// as a recoverable row error. The same round-trip idea `parseLocalDate`
// (`src/dates/format.ts`) already applies to a local-midnight day: the
// constructed instant's own UTC getters must reproduce the exact parsed
// components, or the input didn't describe a real calendar instant.
const partsToSeconds = (parts: DateParts): number | undefined => {
  const { year, month, day, hour, minute, second } = parts;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(ms);
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;

  return roundTrips ? ms / 1000 : undefined;
};

// Every preset reads UTC wall-clock parts — the same `parseDateTimeSeconds`
// convention the dedicated formats use (`../parse-date-time`), never the host
// device's local timezone. `DD.MM.YY HH:MM` maps its 2-digit year to `20YY`,
// matching Sensebank's own dedicated parse exactly (real years past 2099
// never appear in a bank export).
const presets: Record<DateFormatId, DatePreset> = {
  'DD.MM.YYYY HH:MM:SS': {
    pattern: /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/,
    toParts: ([, day, month, year, hour, minute, second]) => ({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    }),
  },
  'DD.MM.YYYY HH:MM': {
    pattern: /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/,
    toParts: ([, day, month, year, hour, minute]) => ({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: 0,
    }),
  },
  'DD.MM.YYYY': {
    pattern: /^(\d{2})\.(\d{2})\.(\d{4})$/,
    toParts: ([, day, month, year]) => ({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: 0,
      minute: 0,
      second: 0,
    }),
  },
  'DD.MM.YY HH:MM': {
    pattern: /^(\d{2})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})$/,
    toParts: ([, day, month, year, hour, minute]) => ({
      year: 2000 + Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: 0,
    }),
  },
  'YYYY-MM-DD HH:MM:SS': {
    pattern: /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
    toParts: ([, year, month, day, hour, minute, second]) => ({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    }),
  },
  'YYYY-MM-DD': {
    pattern: /^(\d{4})-(\d{2})-(\d{2})$/,
    toParts: ([, year, month, day]) => ({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: 0,
      minute: 0,
      second: 0,
    }),
  },
  'MM/DD/YYYY': {
    pattern: /^(\d{2})\/(\d{2})\/(\d{4})$/,
    toParts: ([, month, day, year]) => ({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: 0,
      minute: 0,
      second: 0,
    }),
  },
  'DD/MM/YYYY': {
    pattern: /^(\d{2})\/(\d{2})\/(\d{4})$/,
    toParts: ([, day, month, year]) => ({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: 0,
      minute: 0,
      second: 0,
    }),
  },
};

// The column-mapping date-format picker shows a real WORKED example as each
// option's label, not the RAW preset id ("DD.MM.YYYY HH:MM:SS") — meaningless
// to a user who doesn't already know date-format notation. Every example
// renders off the SAME instant (31 Dec 2026,
// 23:59:59 UTC — an unambiguous day > 12, so DD-first vs MM-first reads
// correctly at a glance) so every option is directly comparable.
export const dateFormatExamples: Record<DateFormatId, string> = {
  'DD.MM.YYYY HH:MM:SS': '31.12.2026 23:59:59',
  'DD.MM.YYYY HH:MM': '31.12.2026 23:59',
  'DD.MM.YYYY': '31.12.2026',
  'DD.MM.YY HH:MM': '31.12.26 23:59',
  'YYYY-MM-DD HH:MM:SS': '2026-12-31 23:59:59',
  'YYYY-MM-DD': '2026-12-31',
  'MM/DD/YYYY': '12/31/2026',
  'DD/MM/YYYY': '31/12/2026',
};

/**
 * Parses one date/time cell against a single named preset, returning `undefined`
 * (never throwing) on a mismatch — the column-mapping core surfaces that as a
 * recoverable per-row `'date'` error (`applyColumnMapping`) rather than
 * aborting the whole import, unlike a dedicated format's own
 * `parseDateTimeSeconds`, which throws because its shape is fixed and known
 * in advance. A cell that matches the preset's SHAPE but describes an
 * impossible calendar instant (`partsToSeconds`'s round-trip check) is the
 * same kind of mismatch, not a distinct case.
 */
export const parseDateWithFormat = (raw: TableCell, id: DateFormatId): number | undefined => {
  const preset = presets[id];
  const match = preset.pattern.exec(String(raw).trim());

  return match ? partsToSeconds(preset.toParts(match)) : undefined;
};
