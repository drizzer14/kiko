import type {
  AmountOperator,
  CategoryRuleMatcher,
  RuleDirection,
  TimeOperator,
} from './category-rules.d';

// Each list is built from a Record keyed by its union, so a new member in the types is a compile
// error here instead of a value the guard or the editor silently misses. The keys are the data;
// the values are null because a boolean value would only add mutants that cannot change the result.
const optionsOf = <Option extends string>(flags: Record<Option, null>): readonly Option[] =>
  Object.keys(flags) as Option[];

export const MATCHER_TYPES = optionsOf<CategoryRuleMatcher['type']>({
  nameIs: null,
  nameStartsWith: null,
  amount: null,
  direction: null,
  time: null,
});
export const AMOUNT_OPERATORS = optionsOf<AmountOperator>({
  eq: null,
  gt: null,
  gte: null,
  lt: null,
  lte: null,
});
export const DIRECTIONS = optionsOf<RuleDirection>({ expense: null, income: null });
export const TIME_OPERATORS = optionsOf<TimeOperator>({ before: null, after: null });
