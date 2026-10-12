import { match } from 'ts-pattern';
import { parseAmount } from '@kiko/currency/parse';
import { Money, toMajor } from '@kiko/currency/money';
import type { Currency } from '@kiko/currency/currency';
import type { CategoryRuleMatcher } from '@kiko/categories/category-rules';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';
import { groupAmount, majorAmountText } from '@kiko/screens/forms/amount-format';

import type { DraftConversion, MatcherDraft, MatcherDraftError } from './rule-draft.types';

const MINUTES_PER_HOUR = 60;

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

const withFields = (blank: MatcherDraft, fields: Partial<MatcherDraft>): MatcherDraft => ({
  ...blank,
  ...fields,
});

const draftOf = (matcher: CategoryRuleMatcher, blank: MatcherDraft): MatcherDraft =>
  match(matcher)
    .with({ type: 'nameIs' }, { type: 'nameStartsWith' }, ({ type, text }) =>
      withFields(blank, { type, text }),
    )
    .with({ type: 'amount' }, ({ operator, minorUnits, currency }) =>
      withFields(blank, {
        type: 'amount',
        amountOperator: operator,
        amountText: groupAmount(majorAmountText(currency, minorUnits)),
        currency,
      }),
    )
    .with({ type: 'direction' }, ({ direction }) =>
      withFields(blank, { type: 'direction', direction }),
    )
    .with({ type: 'time' }, ({ operator, minuteOfDay }) =>
      withFields(blank, { type: 'time', timeOperator: operator, minuteOfDay }),
    )
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

// The amount is the typed number through the currency's own scale. It must come back unchanged
// from minor units, so a digit past the scale (1.005 in a currency of two decimals) is refused
// instead of silently rounded away, and so is a number too large to hold as a whole minor unit.
const amountOutcome = ({ amountText, amountOperator, currency }: MatcherDraft): DraftOutcome => {
  const major = parseAmount(amountText);
  const { minorUnits } = Money.fromMajor(currency, major);
  const isExact =
    major >= 0 &&
    !Object.is(major, -0) &&
    Number.isSafeInteger(minorUnits) &&
    toMajor(minorUnits, currency) === major;

  return isExact
    ? { matcher: { type: 'amount', operator: amountOperator, minorUnits, currency } }
    : { error: 'errorAmount' };
};

const matcherOutcome = (matcher: CategoryRuleMatcher): DraftOutcome => ({ matcher });

const outcomeOf = (draft: MatcherDraft): DraftOutcome =>
  match(draft.type)
    .with('nameIs', 'nameStartsWith', (type) => nameOutcome(type, draft.text))
    .with('amount', () => amountOutcome(draft))
    .with('direction', () => matcherOutcome({ type: 'direction', direction: draft.direction }))
    .with('time', () =>
      matcherOutcome({
        type: 'time',
        operator: draft.timeOperator,
        minuteOfDay: draft.minuteOfDay,
      }),
    )
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
