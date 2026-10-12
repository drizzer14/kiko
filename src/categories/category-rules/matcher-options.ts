import type {
  AmountOperator,
  CategoryRuleMatcher,
  RuleDirection,
  TimeOperator,
} from './category-rules.d';

// Each list is built from a Record keyed by its union, so a new member in the types is a compile
// error here instead of a value the guard or the editor silently misses.
const optionsOf = <Option extends string>(flags: Record<Option, true>): Option[] =>
  Object.keys(flags) as Option[];

export const MATCHER_TYPES = optionsOf<CategoryRuleMatcher['type']>({
  nameIs: true,
  nameStartsWith: true,
  amount: true,
  direction: true,
  time: true,
});
export const AMOUNT_OPERATORS = optionsOf<AmountOperator>({
  eq: true,
  gt: true,
  gte: true,
  lt: true,
  lte: true,
});
export const DIRECTIONS = optionsOf<RuleDirection>({ expense: true, income: true });
export const TIME_OPERATORS = optionsOf<TimeOperator>({ before: true, after: true });
