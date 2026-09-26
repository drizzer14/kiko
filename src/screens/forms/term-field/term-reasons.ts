import { match } from 'ts-pattern';
import { parseAmount } from '@kiko/currency/parse';
import { MAX_TERM_MONTHS } from '@kiko/holdings/term-limits';

// The unit a term is typed in. Storage is always whole months (`termMonths`);
// the unit only changes how the typed number reads.
export const termUnits = ['months', 'years'] as const;

export type TermUnit = (typeof termUnits)[number];

export type TermInput = { value: string; unit: TermUnit };

export type TermReasonKey =
  | 'forms.holding.termMonthsError'
  | 'forms.holding.termMonthsMaxError'
  | 'forms.holding.termYearsError'
  | 'forms.holding.termYearsMaxError';

const MONTHS_PER_YEAR = 12;

const monthsPerUnit = (unit: TermUnit): number =>
  match(unit)
    .with('months', () => 1)
    .with('years', () => MONTHS_PER_YEAR)
    .exhaustive();

// The largest number a user may type in `unit` — the same span either way,
// `MAX_TERM_MONTHS`, since an uncapped term makes the deposit/loan schedule
// math build an unbounded number of periods.
export const termMaxFor = (unit: TermUnit): number => MAX_TERM_MONTHS / monthsPerUnit(unit);

const isWholeAboveZero = (count: number): boolean => Number.isInteger(count) && count > 0;

// The term field's OWN reason, in the unit it was typed in: a whole number
// above 0, then at most `termMaxFor(unit)`. A term over the cap gets its own
// key naming the maximum, not the generic one.
export const termReasonKey = (value: string, unit: TermUnit): TermReasonKey | null => {
  const count = parseAmount(value);
  const keys = match(unit)
    .with('months', () => ({
      invalid: 'forms.holding.termMonthsError' as const,
      tooLong: 'forms.holding.termMonthsMaxError' as const,
    }))
    .with('years', () => ({
      invalid: 'forms.holding.termYearsError' as const,
      tooLong: 'forms.holding.termYearsMaxError' as const,
    }))
    .exhaustive();

  if (!isWholeAboveZero(count)) {
    return keys.invalid;
  }

  return count > termMaxFor(unit) ? keys.tooLong : null;
};

// The stored month count for a typed term, or `null` when the typed number is
// not a whole number above 0.
export const termMonthsFromInput = (value: string, unit: TermUnit): number | null => {
  const count = parseAmount(value);

  return isWholeAboveZero(count) ? count * monthsPerUnit(unit) : null;
};

// The edit-mode seed for a stored month count: a whole number of years shows
// in years, anything else in months.
export const termInputFromMonths = (months: number): TermInput =>
  months % MONTHS_PER_YEAR === 0
    ? { value: String(months / MONTHS_PER_YEAR), unit: 'years' }
    : { value: String(months), unit: 'months' };
