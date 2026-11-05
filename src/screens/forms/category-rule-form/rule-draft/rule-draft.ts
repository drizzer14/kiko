import { match } from 'ts-pattern';
import {
  type CategoryRuleMatcher,
  MCC_DIGITS,
  MINUTES_PER_HOUR,
} from '@kiko/categories/category-rules';
import { parseAmount } from '@kiko/currency/parse';
import { Money, toMajor } from '@kiko/currency/money';
import { IBAN_PATTERN, ibanKeyOf } from '@kiko/transactions/iban';
import { type Currency, currencyScale } from '@kiko/currency/currency';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';
import { groupAmount, majorAmountText } from '@kiko/screens/forms/amount-format';

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
  mccText: '',
  accountId: null,
  ibanText: '',
});

const draftOf = (
  matcher: CategoryRuleMatcher,
  blank: MatcherDraft,
  liveAccountIds: ReadonlySet<string>,
): MatcherDraft =>
  match<CategoryRuleMatcher, MatcherDraft>(matcher)
    .with(
      { type: 'nameIs' },
      { type: 'nameStartsWith' },
      { type: 'nameContains' },
      ({ type, text }) => ({
        ...blank,
        type,
        text,
      }),
    )
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
    .with({ type: 'mcc' }, ({ code }) => ({
      ...blank,
      type: 'mcc',
      mccText: String(code).padStart(MCC_DIGITS, '0'),
    }))
    // An account no row holds any more seeds as none, so Save asks for a pick instead of storing
    // an id that can never match.
    .with({ type: 'account' }, ({ accountId }) => ({
      ...blank,
      type: 'account',
      accountId: liveAccountIds.has(accountId) ? accountId : null,
    }))
    .with({ type: 'counterIban' }, ({ iban }) => ({
      ...blank,
      type: 'counterIban',
      ibanText: iban,
    }))
    .exhaustive();

/**
 * The rows an edit starts from, one per stored matcher, in their stored order. `liveAccountIds`
 * are the accounts that exist now: a stored account outside them seeds as none.
 */
export const toMatcherDrafts = (
  matchers: readonly CategoryRuleMatcher[],
  baseCurrency: Currency,
  liveAccountIds: ReadonlySet<string>,
): MatcherDraft[] =>
  matchers.map((matcher) => draftOf(matcher, emptyMatcherDraft(baseCurrency), liveAccountIds));

const nameOutcome = (
  type: 'nameIs' | 'nameStartsWith' | 'nameContains',
  text: string,
): DraftOutcome =>
  normalizeTransactionName(text) === ''
    ? { error: 'errorName' }
    : { matcher: { type, text: text.trim() } };

const MCC_PATTERN = new RegExp(`^\\d{${MCC_DIGITS}}$`);

// Exactly four digits: the field keeps only digits, so a shorter text is an unfinished code.
const mccOutcome = ({ mccText }: MatcherDraft): DraftOutcome =>
  MCC_PATTERN.test(mccText)
    ? { matcher: { type: 'mcc', code: Number(mccText) } }
    : { error: 'errorMcc' };

const accountOutcome = ({ accountId }: MatcherDraft): DraftOutcome =>
  accountId === null ? { error: 'errorAccount' } : { matcher: { type: 'account', accountId } };

// The format only, as the parser reads it: the stored text is the key form, so a spaced
// lower-case entry saves like any other.
const ibanOutcome = ({ ibanText }: MatcherDraft): DraftOutcome => {
  const iban = ibanKeyOf(ibanText);

  return IBAN_PATTERN.test(iban)
    ? { matcher: { type: 'counterIban', iban } }
    : { error: 'errorIban' };
};

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
    .with('nameIs', 'nameStartsWith', 'nameContains', (type) => nameOutcome(type, draft.text))
    .with('amount', () => amountOutcome(draft))
    .with('direction', () => ({ matcher: { type: 'direction', direction: draft.direction } }))
    .with('time', () => ({
      matcher: { type: 'time', operator: draft.timeOperator, minuteOfDay: draft.minuteOfDay },
    }))
    .with('mcc', () => mccOutcome(draft))
    .with('account', () => accountOutcome(draft))
    .with('counterIban', () => ibanOutcome(draft))
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
