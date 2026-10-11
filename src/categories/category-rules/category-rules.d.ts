import type { Currency } from '@kiko/currency/currency';

export type AmountOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte';

export type RuleDirection = 'expense' | 'income';

export type TimeOperator = 'before' | 'after';

export type CategoryRuleMatcher =
  | { type: 'nameIs'; text: string }
  | { type: 'nameStartsWith'; text: string }
  | { type: 'amount'; operator: AmountOperator; minorUnits: number; currency: Currency }
  | { type: 'direction'; direction: RuleDirection }
  | { type: 'time'; operator: TimeOperator; minuteOfDay: number };

export type MatcherOfType<Type extends CategoryRuleMatcher['type']> = Extract<
  CategoryRuleMatcher,
  { type: Type }
>;

// Structurally equal to the schema's category rule row, so this folder needs no db import.
export type StoredCategoryRule = {
  id: string;
  category: string;
  matchers: string;
  createdAt: number;
  updatedAt: number;
};

export type PreparedRule = {
  id: string;
  category: string;
  createdAt: number;
  updatedAt: number;
  // For matching only: name texts are already normalized, so evaluating a row compares them as
  // they are. Never show or store these; the text is lowercased.
  matchers: readonly CategoryRuleMatcher[];
  // For display and for writing the rule back: the matchers exactly as the user typed them.
  displayMatchers: readonly CategoryRuleMatcher[];
  // Position in priority order, 0 = strongest.
  rank: number;
};

export type PreparedRules = {
  // Every readable rule, in priority order.
  ordered: readonly PreparedRule[];
  // Normalized text of the first nameIs matcher -> the rules indexed under it, in priority order.
  byName: ReadonlyMap<string, readonly PreparedRule[]>;
  // Rules with no nameIs matcher, in priority order.
  withoutName: readonly PreparedRule[];
  // Rules that failed the guard; they never match.
  unreadable: readonly StoredCategoryRule[];
};

export type RuleSubject = {
  normalizedName: string;
  absoluteMinorUnits: number | null;
  currency: Currency | null;
  direction: RuleDirection | null;
  minuteOfDay: number | null;
};

export type RewriteCandidate = {
  id: string;
  description: string;
  amountMinorUnits: number;
  time: number;
  currency: Currency | null;
  category: string | null;
  categorySetByHand: boolean;
  exchangePairId: string | null;
  exchangeCounterpartHoldingId: string | null;
  setsBalance: boolean;
  changeGroupId: string | null;
};

export type RuleValidation =
  | { kind: 'valid' }
  | { kind: 'noMatchers' }
  | { kind: 'neverMatches' }
  | { kind: 'duplicate'; category: string };
