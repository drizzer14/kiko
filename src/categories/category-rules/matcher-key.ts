import { match } from 'ts-pattern';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';

import type { CategoryRuleMatcher } from './category-rules.d';

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

// The one definition of "the same matcher", so the duplicate check and the priority count cannot
// disagree: a matcher written twice is still one condition and adds no strength.
export const distinctMatcherKeys = (matchers: readonly CategoryRuleMatcher[]): string[] =>
  [...new Set(matchers.map(keyOfMatcher))].sort();
