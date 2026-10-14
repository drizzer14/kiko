import { match } from 'ts-pattern';
import { parseAmount } from '@kiko/currency/parse';
import { Money, toMajor } from '@kiko/currency/money';
import { type Currency, currencyScale } from '@kiko/currency/currency';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';
import { groupAmount, majorAmountText } from '@kiko/screens/forms/amount-format';
import { type CategoryRuleMatcher, MINUTES_PER_HOUR } from '@kiko/categories/category-rules';

import type { DraftConversion, MatcherDraft, MatcherDraftError } from './rule-draft.types';

// Noon: a time condition a user adds opens on a time in the middle of the day, not on midnight.
const DEFAULT_MINUTE_OF_DAY = 12 * MINUTES_PER_HOUR;

type DraftOutcome = { matcher: CategoryRuleMatcher } | { error: MatcherDraftError };

/** A new row: a blank "Name is" condition, with the base currency ready for an amount. */
export const emptyMatcherDraft = (baseCurrency: Currency): MatcherDraft => ({
  type: 'nameIs',
  text: '',
  amountOperator: 'eq',
  amountText: '',
  currency: baseCurrency,
  direction: 'expense',
  timeOperator: 'before',
  minuteOfDay: DEFAULT_MINUTE_OF_DAY,
});

const draftOf = (matcher: CategoryRuleMatcher, blank: MatcherDraft): MatcherDraft =>
  match<CategoryRuleMatcher, MatcherDraft>(matcher)
    .with({ type: 'nameIs' }, { type: 'nameStartsWith' }, ({ type, text }) => ({
      ...blank,
      type,
      text,
    }))
    .with({ type: 'amount' }, ({ operator, minorUnits, currency }) => ({
      ...blank,
      type: 'amount',
      amountOperator: operator,
      amountText: groupAmount(majorAmountText(currency, minorUnits)),
      currency,
    }))
    .with({ type: 'direction' }, ({ direction }) => ({ ...blank, type: 'direction', direction }))
    .with({ type: 'time' }, ({ operator, minuteOfDay }) => ({
      ...blank,
      type: 'time',
      timeOperator: operator,
      minuteOfDay,
    }))
    .exhaustive();

/** The rows an edit starts from, one per stored matcher, in their stored order. */
export const toMatcherDrafts = (
  matchers: readonly CategoryRuleMatcher[],
  baseCurrency: Currency,
): MatcherDraft[] => matchers.map((matcher) => draftOf(matcher, emptyMatcherDraft(baseCurrency)));

const nameOutcome = (type: 'nameIs' | 'nameStartsWith', text: string): DraftOutcome =>
  normalizeTransactionName(text) === ''
    ? { error: 'errorName' }
    : { matcher: { type, text: text.trim() } };

// A currency of no decimals gets its own message: "up to 0 decimal places" reads wrong.
const decimalsError = (digits: number): MatcherDraftError =>
  digits === 0 ? 'errorAmountWholeOnly' : { kind: 'errorAmountDecimals', digits };

// The digits the typed text keeps after the decimal mark, as parseAmount reads the mark (the
// last '.' or ','), without the zeros that end it: "1.50" has one.
const typedFractionDigits = (amountText: string): number => {
  const fraction = amountText.replace(/\s/g, '').match(/[.,](\d*)$/)?.[1] ?? '';

  return fraction.replace(/0+$/, '').length;
};

// A number near the safe limit can fail the round trip with no digit past the scale, because a
// float cannot hold that many digits; that is too large, not too many decimals.
const roundTripError = (amountText: string, currency: Currency): MatcherDraftError =>
  typedFractionDigits(amountText) <= currencyScale[currency]
    ? 'errorAmountTooLarge'
    : decimalsError(currencyScale[currency]);

// The amount is the typed number through the currency's own scale. It must come back unchanged
// from minor units, so a digit past the scale (1.005 in a currency of two decimals) is refused
// instead of silently rounded away, and so is a number too large to hold as a whole minor unit.
// One input gets one reason, checked in this order: below zero (a blank or non-number amount
// included, which parses to NaN), too large, then too many decimals.
const amountOutcome = ({ amountText, amountOperator, currency }: MatcherDraft): DraftOutcome => {
  const major = parseAmount(amountText);
  const { minorUnits } = Money.fromMajor(currency, major);

  if (!(major >= 0) || Object.is(major, -0)) {
    return { error: 'errorAmountNegative' };
  }

  if (!Number.isSafeInteger(minorUnits)) {
    return { error: 'errorAmountTooLarge' };
  }

  return toMajor(minorUnits, currency) === major
    ? { matcher: { type: 'amount', operator: amountOperator, minorUnits, currency } }
    : { error: roundTripError(amountText, currency) };
};

const outcomeOf = (draft: MatcherDraft): DraftOutcome =>
  match<MatcherDraft['type'], DraftOutcome>(draft.type)
    .with('nameIs', 'nameStartsWith', (type) => nameOutcome(type, draft.text))
    .with('amount', () => amountOutcome(draft))
    .with('direction', () => ({ matcher: { type: 'direction', direction: draft.direction } }))
    .with('time', () => ({
      matcher: { type: 'time', operator: draft.timeOperator, minuteOfDay: draft.minuteOfDay },
    }))
    .exhaustive();

/**
 * The matchers the rows stand for, or the rows that cannot become one. Each row is judged on the
 * fields of its own type only, so a leftover amount under a "Name is" row never blocks the save.
 */
export const fromMatcherDrafts = (drafts: readonly MatcherDraft[]): DraftConversion => {
  const matchers: CategoryRuleMatcher[] = [];
  const errors = new Map<number, MatcherDraftError>();

  drafts.map(outcomeOf).forEach((outcome, position) => {
    if ('error' in outcome) {
      errors.set(position, outcome.error);
    } else {
      matchers.push(outcome.matcher);
    }
  });

  return errors.size > 0 ? { kind: 'invalid', errors } : { kind: 'valid', matchers };
};
