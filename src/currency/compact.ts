import { applySymbolPlacement, type Currency } from './currency';

// A compact money unit: the divisor that scales a major-unit value into the
// unit's magnitude, the decimals to render it at, and the letter suffix. Chosen
// once per axis by `chooseCompactUnit` so every label on that axis shares it.
type CompactUnit = { suffix: string; divisor: number; decimals: number };

// Candidate units, largest to smallest. Millions/billions read at one decimal
// ("1.5M"); thousands and the base unit read as grouped integers ("1,290K",
// "850") — a decimal there would only add noise at that resolution.
const UNITS: readonly CompactUnit[] = [
  { suffix: 'B', divisor: 1_000_000_000, decimals: 1 },
  { suffix: 'M', divisor: 1_000_000, decimals: 1 },
  { suffix: 'K', divisor: 1_000, decimals: 0 },
  { suffix: '', divisor: 1, decimals: 0 },
];

const BASE_UNIT = UNITS[UNITS.length - 1];

// The numeric part of a value in a unit, with locale grouping (e.g. 1,290) and
// the unit's fixed decimals. No sign handling or symbol — that is the caller's.
const compactNumber = (value: number, unit: CompactUnit, locale = 'en-US'): string =>
  (value / unit.divisor).toLocaleString(locale, {
    minimumFractionDigits: unit.decimals,
    maximumFractionDigits: unit.decimals,
  });

// Whether formatting every value at this unit keeps distinct values on distinct
// labels — i.e. rounding to the unit's decimals does not merge adjacent ticks.
const keepsLabelsDistinct = (values: number[], unit: CompactUnit): boolean => {
  const distinctValues = new Set(values).size;
  const distinctLabels = new Set(values.map((value) => compactNumber(value, unit))).size;

  return distinctLabels >= distinctValues;
};

/**
 * Pick ONE compact unit for a whole axis from its set of tick values, adaptive
 * to the spread: start at the largest unit whose magnitude the biggest value
 * reaches, then step DOWN to a smaller unit if formatting at the larger one
 * would collapse adjacent labels onto the same string (values close together
 * relative to their magnitude). Far-apart values keep the larger, shorter unit
 * (e.g. 0.2M–1.5M stays "M"); close ones drop to grouped thousands so the
 * labels stay visually distinct (e.g. 1.2M–1.3M becomes "1,200K"…"1,300K").
 */
export const chooseCompactUnit = (values: number[]): CompactUnit => {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return BASE_UNIT;
  }

  const maxAbs = Math.max(...finite.map((value) => Math.abs(value)));
  const startIndex = UNITS.findIndex((unit) => unit.divisor <= maxAbs);
  const start = startIndex === -1 ? UNITS.length - 1 : startIndex;

  for (let index = start; index < UNITS.length; index += 1) {
    if (keepsLabelsDistinct(finite, UNITS[index])) {
      return UNITS[index];
    }
  }

  return BASE_UNIT;
};

/**
 * Format a base-currency MAJOR-unit value in the chosen compact unit, with the
 * currency symbol placed the same way `formatMoney` places it: suffixed for
 * UAH ("1,290K ₴"), prefixed otherwise ("$1.5M"), with any minus sign ahead of
 * the symbol ("-$1.5M").
 */
export const formatCompactMoney = (
  major: number,
  currency: Currency,
  unit: CompactUnit,
  locale = 'en-US',
): string => {
  const sign = major < 0 ? '-' : '';
  const body = compactNumber(Math.abs(major), unit, locale) + unit.suffix;

  return applySymbolPlacement(currency, sign, body);
};
