import type { RecurringMark, RecurringPeriod } from '../detection';

/** The picker's order, which also settles a tie between two marks of one amount. */
export const RECURRING_PERIODS: readonly RecurringPeriod[] = [
  'weekly',
  'monthly',
  'everyThreeMonths',
  'everySixMonths',
  'yearly',
];

export const periodRankOf = (period: RecurringPeriod): number => RECURRING_PERIODS.indexOf(period);

// By amount, then the picker's order, so the lowest stored amount of a piece names its period and
// a tie between two periods goes to the earlier one, whatever order the marks arrive in. Both
// readers of the marks share it, so what is stored and what is shown never sort apart. It holds
// its own text comparison and imports types only: `@kiko/settings` reaches this leaf and must
// gain no value path to detection.
export const compareMarks = (left: RecurringMark, right: RecurringMark): number =>
  left.amountMinorUnits - right.amountMinorUnits ||
  periodRankOf(left.period) - periodRankOf(right.period) ||
  Number(left.currency > right.currency) - Number(left.currency < right.currency);
