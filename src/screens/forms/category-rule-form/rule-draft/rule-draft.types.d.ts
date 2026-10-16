import type {
  AmountOperator,
  CategoryRuleMatcher,
  RuleDirection,
  TimeOperator,
} from '@kiko/categories/category-rules';
import type { Currency } from '@kiko/currency/currency';

// One row of the editor. Every field of every type is kept, so switching a row's type and back
// finds what was typed; only the fields of the row's own `type` become part of the matcher.
export type MatcherDraft = {
  type: CategoryRuleMatcher['type'];
  text: string;
  amountOperator: AmountOperator;
  // The amount as the field shows it: major units, grouped as typed.
  amountText: string;
  currency: Currency;
  direction: RuleDirection;
  timeOperator: TimeOperator;
  minuteOfDay: number;
};

// The inline error a refused row shows, as the `ruleForm` key it reads. The decimals error carries
// the digits the currency allows, so the message and the check read one scale.
export type MatcherDraftError =
  | 'errorName'
  | 'errorAmountNegative'
  | 'errorAmountTooLarge'
  | 'errorAmountWholeOnly'
  | { kind: 'errorAmountDecimals'; digits: number };

export type DraftConversion =
  | { kind: 'valid'; matchers: CategoryRuleMatcher[] }
  // Keyed by the row's position, so each refused row shows its own error.
  | { kind: 'invalid'; errors: ReadonlyMap<number, MatcherDraftError> };
