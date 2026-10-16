import type { ParseKeys, TFunction } from 'i18next';

import type { AmountOperator, RuleDirection, TimeOperator } from './category-rules.d';

// The translation key of each member of a matcher's unions, read by the editor's pickers; the
// direction table is also read by a rule's summary, so a direction never reads differently in
// the two.
export const AMOUNT_OPERATOR_LABEL_KEYS: Record<AmountOperator, ParseKeys> = {
  eq: 'ruleForm.equal',
  gt: 'ruleForm.more',
  gte: 'ruleForm.atLeast',
  lt: 'ruleForm.less',
  lte: 'ruleForm.atMost',
};

// The labels of a rule card's table, which name their subject because the row stands alone
// ("Amount is more than"), where the picker above shows the operator under a field already named.
export const AMOUNT_ROW_LABEL_KEYS: Record<AmountOperator, ParseKeys> = {
  eq: 'categoryPage.amountEqual',
  gt: 'categoryPage.amountMore',
  gte: 'categoryPage.amountAtLeast',
  lt: 'categoryPage.amountLess',
  lte: 'categoryPage.amountAtMost',
};

export const TIME_ROW_LABEL_KEYS: Record<TimeOperator, ParseKeys> = {
  before: 'categoryPage.timeBefore',
  after: 'categoryPage.timeAfter',
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
