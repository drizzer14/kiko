import type { ParseKeys, TFunction } from 'i18next';

import type { AmountOperator, RuleDirection, TimeOperator } from './category-rules.d';

// The translation key of each member of a matcher's unions, read by the editor's pickers and by the
// one-line summary of a rule, so a condition never reads differently in the two.
export const AMOUNT_OPERATOR_LABEL_KEYS: Record<AmountOperator, ParseKeys> = {
  eq: 'ruleForm.equal',
  gt: 'ruleForm.more',
  gte: 'ruleForm.atLeast',
  lt: 'ruleForm.less',
  lte: 'ruleForm.atMost',
};

export const DIRECTION_LABEL_KEYS: Record<RuleDirection, ParseKeys> = {
  expense: 'forms.transaction.expense',
  income: 'forms.transaction.income',
};

export const TIME_OPERATOR_LABEL_KEYS: Record<TimeOperator, ParseKeys> = {
  before: 'ruleForm.before',
  after: 'ruleForm.after',
};

// The translated label of every member, for a picker that takes the whole table.
export const labelsOf = <Option extends string>(
  keys: Record<Option, ParseKeys>,
  t: TFunction,
): Record<Option, string> =>
  Object.fromEntries(
    Object.entries<ParseKeys>(keys).map(([option, key]) => [option, t(key)]),
  ) as Record<Option, string>;
