import { match } from 'ts-pattern';
import { isRecord } from '@kiko/type-guards';
import { bifoldr, eitherSync } from 'fnts/either';
import { isCurrency } from '@kiko/currency/currency';
import { IBAN_PATTERN, ibanKeyOf } from '@kiko/transactions/iban';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';

import type { CategoryRuleMatcher } from './category-rules.d';
import { LAST_MINUTE_OF_DAY, MCC_DIGITS } from './rule-constants';
import { AMOUNT_OPERATORS, DIRECTIONS, TIME_OPERATORS } from './matcher-options';

const isOneOf = <Option extends string>(
  options: readonly Option[],
  value: unknown,
): value is Option => typeof value === 'string' && (options as readonly string[]).includes(value);

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isMinuteOfDay = (value: unknown): value is number =>
  isNonNegativeSafeInteger(value) && value <= LAST_MINUTE_OF_DAY;

// A blank name would match every blank description, so it is no matcher at all.
const isUsableName = (value: unknown): value is string =>
  typeof value === 'string' && normalizeTransactionName(value) !== '';

const parseNameMatcher = (
  type: 'nameIs' | 'nameStartsWith' | 'nameContains',
  record: Record<string, unknown>,
): CategoryRuleMatcher | null => (isUsableName(record.text) ? { type, text: record.text } : null);

const isMerchantCode = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 10 ** MCC_DIGITS - 1;

const parseMccMatcher = (record: Record<string, unknown>): CategoryRuleMatcher | null =>
  isMerchantCode(record.code) ? { type: 'mcc', code: record.code } : null;

const parseAccountMatcher = (record: Record<string, unknown>): CategoryRuleMatcher | null =>
  typeof record.accountId === 'string' && record.accountId !== ''
    ? { type: 'account', accountId: record.accountId }
    : null;

// Stored in the key form, so a value typed with spaces in lower case reads like every other.
const parseIbanMatcher = (record: Record<string, unknown>): CategoryRuleMatcher | null => {
  const iban = typeof record.iban === 'string' ? ibanKeyOf(record.iban) : '';

  return IBAN_PATTERN.test(iban) ? { type: 'counterIban', iban } : null;
};

const parseAmountMatcher = (record: Record<string, unknown>): CategoryRuleMatcher | null => {
  const { operator, minorUnits, currency } = record;

  if (
    !isOneOf(AMOUNT_OPERATORS, operator) ||
    !isNonNegativeSafeInteger(minorUnits) ||
    typeof currency !== 'string' ||
    !isCurrency(currency)
  ) {
    return null;
  }

  return { type: 'amount', operator, minorUnits, currency };
};

const parseDirectionMatcher = (record: Record<string, unknown>): CategoryRuleMatcher | null =>
  isOneOf(DIRECTIONS, record.direction) ? { type: 'direction', direction: record.direction } : null;

const parseTimeMatcher = (record: Record<string, unknown>): CategoryRuleMatcher | null =>
  isOneOf(TIME_OPERATORS, record.operator) && isMinuteOfDay(record.minuteOfDay)
    ? { type: 'time', operator: record.operator, minuteOfDay: record.minuteOfDay }
    : null;

const parseMatcher = (value: unknown): CategoryRuleMatcher | null => {
  if (!isRecord(value)) {
    return null;
  }

  return match(value.type)
    .with('nameIs', 'nameStartsWith', 'nameContains', (type) => parseNameMatcher(type, value))
    .with('amount', () => parseAmountMatcher(value))
    .with('direction', () => parseDirectionMatcher(value))
    .with('time', () => parseTimeMatcher(value))
    .with('mcc', () => parseMccMatcher(value))
    .with('account', () => parseAccountMatcher(value))
    .with('counterIban', () => parseIbanMatcher(value))
    .otherwise(() => null);
};

const isMatcher = (matcher: CategoryRuleMatcher | null): matcher is CategoryRuleMatcher =>
  matcher !== null;

// One bad matcher fails the whole list: a rule that silently dropped a matcher would match more
// rows than the user asked for.
export const parseRuleMatchers = (json: string): CategoryRuleMatcher[] | null => {
  const parsed = bifoldr(eitherSync<unknown, unknown>(() => JSON.parse(json)));

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return null;
  }

  const matchers: (CategoryRuleMatcher | null)[] = parsed.map(parseMatcher);

  return matchers.every(isMatcher) ? matchers : null;
};
