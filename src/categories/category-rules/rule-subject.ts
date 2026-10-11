import type { Currency } from '@kiko/currency/currency';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';

import type { RuleDirection, RuleSubject } from './category-rules.d';

const MINUTES_PER_HOUR = 60;

// The wall clock of the device zone, read with local getters: a day with 23 or 25 hours still
// puts 18:30 at minute 1110.
export const minuteOfDayOf = (time: number): number => {
  const date = new Date(time);

  return date.getHours() * MINUTES_PER_HOUR + date.getMinutes();
};

// A zero amount is neither: a rule for expenses or incomes never claims a row that moved nothing.
const directionOf = (amountMinorUnits: number): RuleDirection | null => {
  if (amountMinorUnits < 0) {
    return 'expense';
  }

  if (amountMinorUnits > 0) {
    return 'income';
  }

  return null;
};

export const subjectOfStoredRow = (row: {
  description: string | null;
  amountMinorUnits: number;
  time: number;
  currency: Currency | null;
}): RuleSubject => ({
  normalizedName: normalizeTransactionName(row.description ?? ''),
  absoluteMinorUnits: Math.abs(row.amountMinorUnits),
  currency: row.currency,
  direction: directionOf(row.amountMinorUnits),
  minuteOfDay: minuteOfDayOf(row.time),
});

export const subjectOfDraft = (draft: {
  description: string;
  absoluteMinorUnits: number | null;
  currency: Currency | null;
  direction: RuleDirection;
  time: number;
}): RuleSubject => ({
  normalizedName: normalizeTransactionName(draft.description),
  absoluteMinorUnits: draft.absoluteMinorUnits,
  currency: draft.currency,
  direction: draft.direction,
  minuteOfDay: minuteOfDayOf(draft.time),
});
