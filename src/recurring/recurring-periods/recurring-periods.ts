import type { RecurringPeriod } from '../detection';

/** The picker's order, which also settles a tie between two marks of one amount. */
export const RECURRING_PERIODS: readonly RecurringPeriod[] = [
  'weekly',
  'monthly',
  'everyThreeMonths',
  'everySixMonths',
  'yearly',
];
