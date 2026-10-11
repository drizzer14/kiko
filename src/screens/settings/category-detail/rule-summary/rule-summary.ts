import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import type {
  AmountOperator,
  CategoryRuleMatcher,
  TimeOperator,
} from '@kiko/categories/category-rules';
import type { Currency } from '@kiko/currency/currency';
import { type TimeClock, formatTime } from '@kiko/dates';

type RuleSummaryOptions = {
  t: TFunction;
  clock: TimeClock;
  formatAmount: (minorUnits: number, currency: Currency) => string;
};

const SEPARATOR = ' · ';

const amountOperatorLabel = (operator: AmountOperator, t: TFunction): string =>
  match(operator)
    .with('eq', () => t('ruleForm.equal'))
    .with('gt', () => t('ruleForm.more'))
    .with('gte', () => t('ruleForm.atLeast'))
    .with('lt', () => t('ruleForm.less'))
    .with('lte', () => t('ruleForm.atMost'))
    .exhaustive();

const timeOperatorLabel = (operator: TimeOperator, t: TFunction): string =>
  match(operator)
    .with('before', () => t('ruleForm.before'))
    .with('after', () => t('ruleForm.after'))
    .exhaustive();

// A day with no clock change, so every minute of the day exists as a wall-clock time.
const wallClockOf = (minuteOfDay: number): Date => new Date(2000, 0, 1, 0, minuteOfDay);

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
        `${amountOperatorLabel(operator, t)} ${formatAmount(minorUnits, currency)}`,
    )
    .with({ type: 'direction' }, ({ direction }) =>
      match(direction)
        .with('expense', () => t('forms.transaction.expense'))
        .with('income', () => t('forms.transaction.income'))
        .exhaustive(),
    )
    .with(
      { type: 'time' },
      ({ operator, minuteOfDay }) =>
        `${timeOperatorLabel(operator, t)} ${formatTime(wallClockOf(minuteOfDay), clock)}`,
    )
    .exhaustive();

/** One line for a rule: its conditions in the order they are stored, joined by a middle dot. */
export const ruleSummary = (
  matchers: readonly CategoryRuleMatcher[],
  options: RuleSummaryOptions,
): string => matchers.map((matcher) => describeMatcher(matcher, options)).join(SEPARATOR);
