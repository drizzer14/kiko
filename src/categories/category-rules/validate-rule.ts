import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';

import type { CategoryRuleMatcher, PreparedRule, RuleValidation } from './category-rules.d';

type MatcherOfType<Type extends CategoryRuleMatcher['type']> = Extract<
  CategoryRuleMatcher,
  { type: Type }
>;

type IntegerRange = { lowest: number; highest: number };

const LAST_MINUTE_OF_DAY = 1439;
const KEY_SEPARATOR = '\u0000';

const ofType = <Type extends CategoryRuleMatcher['type']>(
  matchers: readonly CategoryRuleMatcher[],
  type: Type,
): MatcherOfType<Type>[] =>
  matchers.filter((matcher): matcher is MatcherOfType<Type> => matcher.type === type);

const isEmptyRange = (range: IntegerRange): boolean => range.lowest > range.highest;

// Amounts are absolute, so the range starts at 0 and stays over integers.
const narrowAmountRange = (
  range: IntegerRange,
  { operator, minorUnits }: MatcherOfType<'amount'>,
): IntegerRange =>
  match(operator)
    .with('eq', () => ({
      lowest: Math.max(range.lowest, minorUnits),
      highest: Math.min(range.highest, minorUnits),
    }))
    .with('gt', () => ({ ...range, lowest: Math.max(range.lowest, minorUnits + 1) }))
    .with('gte', () => ({ ...range, lowest: Math.max(range.lowest, minorUnits) }))
    .with('lt', () => ({ ...range, highest: Math.min(range.highest, minorUnits - 1) }))
    .with('lte', () => ({ ...range, highest: Math.min(range.highest, minorUnits) }))
    .exhaustive();

const narrowTimeRange = (
  range: IntegerRange,
  { operator, minuteOfDay }: MatcherOfType<'time'>,
): IntegerRange =>
  operator === 'before'
    ? { ...range, highest: Math.min(range.highest, minuteOfDay - 1) }
    : { ...range, lowest: Math.max(range.lowest, minuteOfDay) };

const directionsCanMatch = (matchers: readonly CategoryRuleMatcher[]): boolean =>
  new Set(ofType(matchers, 'direction').map(({ direction }) => direction)).size <= 1;

// A zero amount has no direction, so a range that holds only 0 can never meet one.
const amountsCanMatch = (matchers: readonly CategoryRuleMatcher[]): boolean => {
  const amounts = ofType(matchers, 'amount');

  if (amounts.length === 0) {
    return true;
  }

  if (new Set(amounts.map(({ currency }) => currency)).size > 1) {
    return false;
  }

  const range = amounts.reduce(narrowAmountRange, {
    lowest: 0,
    highest: Number.POSITIVE_INFINITY,
  });
  const onlyZero = range.lowest === 0 && range.highest === 0;
  const hasDirection = ofType(matchers, 'direction').length > 0;

  return !isEmptyRange(range) && !(onlyZero && hasDirection);
};

const timesCanMatch = (matchers: readonly CategoryRuleMatcher[]): boolean =>
  !isEmptyRange(
    ofType(matchers, 'time').reduce(narrowTimeRange, { lowest: 0, highest: LAST_MINUTE_OF_DAY }),
  );

const normalizedTextsOf = (
  matchers: readonly CategoryRuleMatcher[],
  type: 'nameIs' | 'nameStartsWith',
): string[] => ofType(matchers, type).map(({ text }) => normalizeTransactionName(text));

const longestOf = (texts: readonly string[]): string =>
  texts.reduce((longest, text) => (text.length > longest.length ? text : longest), '');

// Every prefix has to start the one name the row can have, or the longest prefix when there is
// no exact name.
const namesCanMatch = (matchers: readonly CategoryRuleMatcher[]): boolean => {
  const exactNames = normalizedTextsOf(matchers, 'nameIs');
  const prefixes = normalizedTextsOf(matchers, 'nameStartsWith');
  const reference = exactNames[0] ?? longestOf(prefixes);

  return new Set(exactNames).size <= 1 && prefixes.every((prefix) => reference.startsWith(prefix));
};

export const canEverMatch = (matchers: readonly CategoryRuleMatcher[]): boolean =>
  directionsCanMatch(matchers) &&
  amountsCanMatch(matchers) &&
  timesCanMatch(matchers) &&
  namesCanMatch(matchers);

const keyOfMatcher = (matcher: CategoryRuleMatcher): string =>
  match(matcher)
    .with(
      { type: 'nameIs' },
      { type: 'nameStartsWith' },
      ({ type, text }) => `${type}:${normalizeTransactionName(text)}`,
    )
    .with(
      { type: 'amount' },
      ({ operator, minorUnits, currency }) => `amount:${operator}:${minorUnits}:${currency}`,
    )
    .with({ type: 'direction' }, ({ direction }) => `direction:${direction}`)
    .with({ type: 'time' }, ({ operator, minuteOfDay }) => `time:${operator}:${minuteOfDay}`)
    .exhaustive();

// Sorted, so the same matchers in another order are the same set.
export const matcherSetKey = (matchers: readonly CategoryRuleMatcher[]): string =>
  matchers.map(keyOfMatcher).sort().join(KEY_SEPARATOR);

export const validateRule = (
  matchers: readonly CategoryRuleMatcher[],
  otherRules: readonly PreparedRule[],
  ownId: string | null,
): RuleValidation => {
  if (matchers.length === 0) {
    return { kind: 'noMatchers' };
  }

  if (!canEverMatch(matchers)) {
    return { kind: 'neverMatches' };
  }

  const key = matcherSetKey(matchers);
  const twin = otherRules.find((rule) => rule.id !== ownId && matcherSetKey(rule.matchers) === key);

  return (
    foldMap(maybe(twin), ({ category }) => ({ kind: 'duplicate' as const, category })) ?? {
      kind: 'valid' as const,
    }
  );
};
