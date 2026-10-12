import { match } from 'ts-pattern';
import {
  type CategoryRuleMatcher,
  AMOUNT_OPERATOR_LABEL_KEYS,
  DIRECTION_LABEL_KEYS,
  TIME_OPERATOR_LABEL_KEYS,
  wallClockOf,
} from '@kiko/categories/category-rules';
import type { TFunction } from 'i18next';
import type { Currency } from '@kiko/currency/currency';
import { type TimeClock, formatTime } from '@kiko/dates';

type RuleSummaryOptions = {
  t: TFunction;
  clock: TimeClock;
  formatAmount: (minorUnits: number, currency: Currency) => string;
};

const SEPARATOR = ' · ';

const describeMatcher = (
  matcher: CategoryRuleMatcher,
  { t, clock, formatAmount }: RuleSummaryOptions,
): string =>
  match(matcher)
    .with(
      { type: 'nameIs' },
      ({ text }) => `${t('ruleForm.nameIs')} ${t('categoryPage.quotedName', { name: text })}`,
    )
    .with(
      { type: 'nameStartsWith' },
      ({ text }) =>
        `${t('ruleForm.nameStartsWith')} ${t('categoryPage.quotedName', { name: text })}`,
    )
    .with(
      { type: 'amount' },
      ({ operator, minorUnits, currency }) =>
        `${t(AMOUNT_OPERATOR_LABEL_KEYS[operator])} ${formatAmount(minorUnits, currency)}`,
    )
    .with({ type: 'direction' }, ({ direction }) => t(DIRECTION_LABEL_KEYS[direction]))
    .with(
      { type: 'time' },
      ({ operator, minuteOfDay }) =>
        `${t(TIME_OPERATOR_LABEL_KEYS[operator])} ${formatTime(wallClockOf(minuteOfDay), clock)}`,
    )
    .exhaustive();

/** One line for a rule: its conditions in the order they are stored, joined by a middle dot. */
export const ruleSummary = (
  matchers: readonly CategoryRuleMatcher[],
  options: RuleSummaryOptions,
): string => matchers.map((matcher) => describeMatcher(matcher, options)).join(SEPARATOR);
