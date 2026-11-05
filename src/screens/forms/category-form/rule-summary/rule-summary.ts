import { match } from 'ts-pattern';
import {
  type CategoryRuleMatcher,
  AMOUNT_ROW_LABEL_KEYS,
  DIRECTION_LABEL_KEYS,
  MCC_DIGITS,
  TIME_ROW_LABEL_KEYS,
  wallClockOf,
} from '@kiko/categories/category-rules';
import type { TFunction } from 'i18next';
import type { Currency } from '@kiko/currency/currency';
import { type TimeClock, formatTime } from '@kiko/dates';

type RuleSummaryOptions = {
  t: TFunction;
  clock: TimeClock;
  formatAmount: (minorUnits: number, currency: Currency) => string;
  // The shown name of a live account, null for an id that is in no row.
  accountNameOf: (accountId: string) => string | null;
};

// One condition of a rule: the subject it tests and what it tests it against.
export type RuleRow = { key: string; label: string; value: string };

const SEPARATOR = ' · ';

const describeMatcher = (
  matcher: CategoryRuleMatcher,
  { t, clock, formatAmount, accountNameOf }: RuleSummaryOptions,
): Omit<RuleRow, 'key'> =>
  match(matcher)
    .with({ type: 'nameIs' }, ({ text }) => ({
      label: t('ruleForm.nameIs'),
      value: t('categoryPage.quotedName', { name: text }),
    }))
    .with({ type: 'nameStartsWith' }, ({ text }) => ({
      label: t('ruleForm.nameStartsWith'),
      value: t('categoryPage.quotedName', { name: text }),
    }))
    .with({ type: 'nameContains' }, ({ text }) => ({
      label: t('ruleForm.nameContains'),
      value: t('categoryPage.quotedName', { name: text }),
    }))
    .with({ type: 'amount' }, ({ operator, minorUnits, currency }) => ({
      label: t(AMOUNT_ROW_LABEL_KEYS[operator]),
      value: formatAmount(minorUnits, currency),
    }))
    .with({ type: 'direction' }, ({ direction }) => ({
      label: t('ruleForm.direction'),
      value: t(DIRECTION_LABEL_KEYS[direction]),
    }))
    .with({ type: 'time' }, ({ operator, minuteOfDay }) => ({
      label: t(TIME_ROW_LABEL_KEYS[operator]),
      value: formatTime(wallClockOf(minuteOfDay), clock),
    }))
    .with({ type: 'mcc' }, ({ code }) => ({
      label: t('ruleForm.mcc'),
      value: String(code).padStart(MCC_DIGITS, '0'),
    }))
    .with({ type: 'account' }, ({ accountId }) => ({
      label: t('ruleForm.account'),
      value: accountNameOf(accountId) ?? t('categoryPage.deletedAccount'),
    }))
    .with({ type: 'counterIban' }, ({ iban }) => ({
      label: t('ruleForm.counterIban'),
      value: iban,
    }))
    .exhaustive();

/** One row per condition of a rule, in the order they are stored. */
export const ruleRows = (
  matchers: readonly CategoryRuleMatcher[],
  options: RuleSummaryOptions,
): RuleRow[] =>
  matchers.map((matcher, position) => ({
    // Two conditions of one kind are allowed, so the kind alone does not tell the rows apart.
    key: `${matcher.type}-${position}`,
    ...describeMatcher(matcher, options),
  }));

/** One line for a rule: its rows, each as label then value, joined by a middle dot. */
export const ruleSummary = (rows: readonly RuleRow[]): string =>
  rows.map((row) => `${row.label} ${row.value}`).join(SEPARATOR);
