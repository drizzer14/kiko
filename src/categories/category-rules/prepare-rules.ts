import maybe, { foldMap } from 'fnts/maybe';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';

import type {
  AmountOperator,
  CategoryRuleMatcher,
  PreparedRule,
  PreparedRules,
  RuleSubject,
  StoredCategoryRule,
} from './category-rules.d';
import { parseRuleMatchers } from './parse-rule-matchers';

/**
 * How a rule is read, in one place for every caller (insert path, rewrite, form).
 *
 * A rule matches when EVERY matcher matches. A matcher whose subject field is unknown (a draft
 * with no amount, no holding) does not match.
 * - Names compare on `normalizeTransactionName`; a blank name matches no name matcher.
 * - An amount compares the ABSOLUTE size in minor units, in the matcher's own currency only.
 * - A direction is the sign of the amount; a zero amount has none.
 * - `before X` is a minute strictly earlier than X; `after X` is X or later, so the two split the
 *   day with no gap and no overlap.
 *
 * Priority (a total order, so the first match always wins the same way): more matchers first,
 * then the later `updatedAt`, then the later `createdAt`, then the larger id.
 */

type ParsedRule = Omit<PreparedRule, 'rank'>;

const compareText = (first: string, second: string): number => {
  if (first < second) {
    return -1;
  }

  if (first > second) {
    return 1;
  }

  return 0;
};

const byPriority = (first: ParsedRule, second: ParsedRule): number =>
  second.matchers.length - first.matchers.length ||
  second.updatedAt - first.updatedAt ||
  second.createdAt - first.createdAt ||
  compareText(second.id, first.id);

// Texts are normalized once here so evaluating a row never normalizes a rule again.
const withNormalizedText = (matcher: CategoryRuleMatcher): CategoryRuleMatcher => {
  if (matcher.type === 'nameIs' || matcher.type === 'nameStartsWith') {
    return { ...matcher, text: normalizeTransactionName(matcher.text) };
  }

  return matcher;
};

const isNameIs = (
  matcher: CategoryRuleMatcher,
): matcher is Extract<CategoryRuleMatcher, { type: 'nameIs' }> => matcher.type === 'nameIs';

const indexedNameOf = (rule: ParsedRule): string | undefined =>
  foldMap(maybe(rule.matchers.find(isNameIs)), ({ text }) => text);

const indexByName = (ordered: readonly PreparedRule[]): Map<string, PreparedRule[]> => {
  const byName = new Map<string, PreparedRule[]>();

  for (const rule of ordered) {
    const name = indexedNameOf(rule);

    if (name !== undefined) {
      byName.set(name, [...(byName.get(name) ?? []), rule]);
    }
  }

  return byName;
};

export const prepareRules = (rows: readonly StoredCategoryRule[]): PreparedRules => {
  const readable: ParsedRule[] = [];
  const unreadable: StoredCategoryRule[] = [];

  for (const row of rows) {
    const matchers = parseRuleMatchers(row.matchers);

    if (matchers === null) {
      unreadable.push(row);
    } else {
      readable.push({ ...row, matchers: matchers.map(withNormalizedText) });
    }
  }

  const ordered = readable.sort(byPriority).map((rule, rank) => ({ ...rule, rank }));

  return {
    ordered,
    byName: indexByName(ordered),
    withoutName: ordered.filter((rule) => indexedNameOf(rule) === undefined),
    unreadable,
  };
};

const mergeByRank = (
  first: readonly PreparedRule[],
  second: readonly PreparedRule[],
): readonly PreparedRule[] => {
  if (first.length === 0) {
    return second;
  }

  const merged: PreparedRule[] = [];
  let firstIndex = 0;
  let secondIndex = 0;

  while (firstIndex < first.length && secondIndex < second.length) {
    const firstIsStronger =
      (first[firstIndex] as PreparedRule).rank < (second[secondIndex] as PreparedRule).rank;

    merged.push((firstIsStronger ? first[firstIndex++] : second[secondIndex++]) as PreparedRule);
  }

  return merged.concat(first.slice(firstIndex), second.slice(secondIndex));
};

// A rule is indexed under its first nameIs text and still has to pass every matcher, so the
// candidates are a superset of the winners.
export const candidateRules = (
  prepared: PreparedRules,
  subject: RuleSubject,
): readonly PreparedRule[] =>
  mergeByRank(prepared.byName.get(subject.normalizedName) ?? [], prepared.withoutName);

type MatcherOfType<Type extends CategoryRuleMatcher['type']> = Extract<
  CategoryRuleMatcher,
  { type: Type }
>;

// Plain tables instead of `match(...)`: the insert path evaluates every rule against every row
// of a batch, and building a pattern match per matcher dominated that loop.
const AMOUNT_HOLDS: Record<AmountOperator, (actual: number, expected: number) => boolean> = {
  eq: (actual, expected) => actual === expected,
  gt: (actual, expected) => actual > expected,
  gte: (actual, expected) => actual >= expected,
  lt: (actual, expected) => actual < expected,
  lte: (actual, expected) => actual <= expected,
};

const MATCHER_MATCHES: {
  [Type in CategoryRuleMatcher['type']]: (
    matcher: MatcherOfType<Type>,
    subject: RuleSubject,
  ) => boolean;
} = {
  nameIs: ({ text }, subject) => subject.normalizedName === text,
  nameStartsWith: ({ text }, subject) => subject.normalizedName.startsWith(text),
  amount: ({ operator, minorUnits, currency }, subject) =>
    subject.currency === currency &&
    subject.absoluteMinorUnits !== null &&
    AMOUNT_HOLDS[operator](subject.absoluteMinorUnits, minorUnits),
  direction: ({ direction }, subject) => subject.direction === direction,
  time: ({ operator, minuteOfDay }, subject) =>
    subject.minuteOfDay !== null &&
    (operator === 'before'
      ? subject.minuteOfDay < minuteOfDay
      : subject.minuteOfDay >= minuteOfDay),
};

const matcherMatches = (matcher: CategoryRuleMatcher, subject: RuleSubject): boolean =>
  (
    MATCHER_MATCHES[matcher.type] as (matcher: CategoryRuleMatcher, subject: RuleSubject) => boolean
  )(matcher, subject);

export const matchesRule = (rule: PreparedRule, subject: RuleSubject): boolean =>
  rule.matchers.every((matcher) => matcherMatches(matcher, subject));

export const winningRule = (
  prepared: PreparedRules,
  subject: RuleSubject,
): PreparedRule | undefined =>
  candidateRules(prepared, subject).find((rule) => matchesRule(rule, subject));
