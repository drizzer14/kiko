import { type Currency, currencyScale } from '@kiko/currency/currency';

import { ruleRow } from './__fixtures__/rule-row';
import { prepareRules, winningRule } from './prepare-rules';
import { subjectOfDraft, subjectOfStoredRow } from './rule-subject';
import type { AmountOperator, CategoryRuleMatcher, RuleDirection } from './category-rules.d';

const at = (year: number, month: number, day: number, hour: number, minute: number): number =>
  new Date(year, month, day, hour, minute).getTime();

const NOON = at(2026, 5, 1, 12, 0);

const minorUnitsOf = (major: number, currency: Currency): number =>
  Math.round(major * 10 ** currencyScale[currency]);

const matches = (
  matchers: readonly CategoryRuleMatcher[],
  subject: ReturnType<typeof subjectOfStoredRow>,
): boolean => winningRule(prepareRules([ruleRow({ matchers })]), subject) !== undefined;

const storedSubject = (
  amountMajor: number,
  currency: Currency = 'UAH',
  description: string | null = 'Silpo',
  time: number = NOON,
) =>
  subjectOfStoredRow({
    description,
    amountMinorUnits: minorUnitsOf(amountMajor, currency),
    time,
    currency,
  });

const amountRule = (
  operator: AmountOperator,
  major: number,
  currency: Currency = 'UAH',
): CategoryRuleMatcher => ({
  type: 'amount',
  operator,
  minorUnits: minorUnitsOf(major, currency),
  currency,
});

const directionRule = (direction: RuleDirection): CategoryRuleMatcher => ({
  type: 'direction',
  direction,
});

describe('amount matcher', () => {
  it.each([
    ['M1 eq matches an expense of the same size', 'eq', 500, -500, true],
    ['M2 eq matches an income of the same size (absolute)', 'eq', 500, 500, true],
    ['M4 eq refuses one minor unit more', 'eq', 500, -500.01, false],
    ['M4 eq refuses one minor unit less', 'eq', 500, -499.99, false],
    ['M5 gt refuses the boundary', 'gt', 500, -500, false],
    ['M5 gt accepts one minor unit above', 'gt', 500, -500.01, true],
    ['M6 gte accepts the boundary', 'gte', 500, -500, true],
    ['M6 gte refuses one minor unit below', 'gte', 500, -499.99, false],
    ['M7 lt refuses the boundary', 'lt', 500, -500, false],
    ['M7 lt accepts one minor unit below', 'lt', 500, -499.99, true],
    ['M8 lte accepts the boundary', 'lte', 500, -500, true],
    ['M8 lte refuses one minor unit above', 'lte', 500, -500.01, false],
    ['M9 eq 0 matches a zero amount', 'eq', 0, 0, true],
    ['M10 lt 500 matches a zero amount', 'lt', 500, 0, true],
    ['gt compares the absolute size of an income', 'gt', 500, 500.01, true],
    ['lt compares the absolute size of an income', 'lt', 500, 499.99, true],
    ['lt refuses a larger income', 'lt', 500, 600, false],
  ] as const)('%s', (_label, operator, ruleMajor, amountMajor, expected) => {
    expect(matches([amountRule(operator, ruleMajor)], storedSubject(amountMajor))).toBe(expected);
  });

  it('M3 never matches another currency of the same number', () => {
    expect(matches([amountRule('eq', 500)], storedSubject(-500, 'USD'))).toBe(false);
  });

  it('M15 reads a BTC rule in satoshi', () => {
    const satoshi = 100_000;

    expect(
      matches(
        [{ type: 'amount', operator: 'eq', minorUnits: satoshi, currency: 'BTC' }],
        subjectOfStoredRow({
          description: 'Bitcoin',
          amountMinorUnits: -satoshi,
          time: NOON,
          currency: 'BTC',
        }),
      ),
    ).toBe(true);
  });

  it('M15 scales the BTC fixture to 100 000 sats', () => {
    expect(minorUnitsOf(0.001, 'BTC')).toBe(100_000);
  });
});

describe('direction matcher', () => {
  it.each([
    ['M11 expense refuses a zero amount', 'expense', 0, false],
    ['M11 income refuses a zero amount', 'income', 0, false],
    ['M12 expense matches a negative amount', 'expense', -1, true],
    ['M12 expense refuses a positive amount', 'expense', 1, false],
    ['income matches a positive amount', 'income', 1, true],
    ['income refuses a negative amount', 'income', -1, false],
  ] as const)('%s', (_label, direction, amountMajor, expected) => {
    expect(matches([directionRule(direction)], storedSubject(amountMajor))).toBe(expected);
  });

  it('M13 income with amount >= 1000 matches a +1000.00 row', () => {
    expect(matches([directionRule('income'), amountRule('gte', 1000)], storedSubject(1000))).toBe(
      true,
    );
  });

  it('M14 expense with amount >= 1000 refuses a +1000.00 row (sign against direction)', () => {
    expect(matches([directionRule('expense'), amountRule('gte', 1000)], storedSubject(1000))).toBe(
      false,
    );
  });

  it('refuses the row when only one of the matchers holds', () => {
    expect(matches([directionRule('expense'), amountRule('gte', 1000)], storedSubject(-999))).toBe(
      false,
    );
  });
});

describe('draft subjects', () => {
  const draft = (
    overrides: Partial<Parameters<typeof subjectOfDraft>[0]> = {},
  ): ReturnType<typeof subjectOfDraft> =>
    subjectOfDraft({
      description: 'Silpo',
      absoluteMinorUnits: 50000,
      currency: 'UAH',
      direction: 'expense',
      time: NOON,
      ...overrides,
    });

  it('M16 an amount rule refuses a draft without a holding (no currency)', () => {
    expect(matches([amountRule('eq', 500)], draft({ currency: null }))).toBe(false);
  });

  it('M17 a name rule matches a draft without a holding', () => {
    expect(
      matches(
        [{ type: 'nameIs', text: 'Silpo' }],
        draft({ currency: null, absoluteMinorUnits: null }),
      ),
    ).toBe(true);
  });

  it('M18 an amount rule refuses a draft with a blank amount', () => {
    expect(matches([amountRule('eq', 500)], draft({ absoluteMinorUnits: null }))).toBe(false);
  });

  it('M19 a direction rule matches a draft in that mode with a blank amount', () => {
    expect(
      matches(
        [directionRule('expense')],
        draft({ absoluteMinorUnits: null, direction: 'expense' }),
      ),
    ).toBe(true);
  });

  it('a direction rule refuses a draft in the other mode', () => {
    expect(matches([directionRule('income')], draft({ direction: 'expense' }))).toBe(false);
  });

  it('an amount rule matches a complete draft', () => {
    expect(matches([amountRule('eq', 500)], draft())).toBe(true);
  });
});

describe('time matcher', () => {
  const timeBefore = (hour: number, minute: number): CategoryRuleMatcher => ({
    type: 'time',
    operator: 'before',
    minuteOfDay: hour * 60 + minute,
  });
  const timeAfter = (hour: number, minute: number): CategoryRuleMatcher => ({
    type: 'time',
    operator: 'after',
    minuteOfDay: hour * 60 + minute,
  });
  const atClock = (hour: number, minute: number) =>
    storedSubject(-10, 'UAH', 'Silpo', at(2026, 5, 1, hour, minute));

  it.each([
    ['M20 before 09:00 matches 08:59', timeBefore(9, 0), 8, 59, true],
    ['M20 before 09:00 refuses 09:00', timeBefore(9, 0), 9, 0, false],
    ['M21 after 18:00 refuses 17:59', timeAfter(18, 0), 17, 59, false],
    ['M21 after 18:00 matches 18:00', timeAfter(18, 0), 18, 0, true],
    ['before 00:01 matches 00:00', timeBefore(0, 1), 0, 0, true],
    ['after 23:59 matches 23:59', timeAfter(23, 59), 23, 59, true],
  ])('%s', (_label, matcher, hour, minute, expected) => {
    expect(matches([matcher], atClock(hour, minute))).toBe(expected);
  });

  it.each([
    ['the fall-back day', at(2026, 9, 25, 18, 30)],
    ['the spring-forward day', at(2027, 2, 28, 18, 30)],
  ])('M22 after 18:00 matches 18:30 on %s', (_label, time) => {
    expect(matches([timeAfter(18, 0)], storedSubject(-10, 'UAH', 'Silpo', time))).toBe(true);
  });
});

describe('name matchers', () => {
  const nameIs = (text: string): CategoryRuleMatcher => ({ type: 'nameIs', text });
  const startsWith = (text: string): CategoryRuleMatcher => ({ type: 'nameStartsWith', text });
  const named = (description: string | null) => storedSubject(-10, 'UAH', description);

  it.each([
    ['M24 surrounding spaces and case', nameIs('silpo'), '  SILPO  ', true],
    ['M24 Cyrillic case', nameIs('СІЛЬПО'), 'Сільпо', true],
    ['M24 inner whitespace runs', nameIs('silpo market'), 'Silpo   Market', true],
    ['M24b a decomposed description against a composed rule', nameIs('Café'), 'Café', true],
    ['M24b a composed description against a decomposed rule', nameIs('Café'), 'Café', true],
    ['nameIs refuses a longer name', nameIs('silpo'), 'Silpo Market', false],
    ['M25 starts with matches a longer name', startsWith('silpo'), 'Silpo Market 12', true],
    [
      'M25 starts with refuses a name that only contains it',
      startsWith('silpo'),
      'Mega Silpo',
      false,
    ],
    ['starts with matches the exact name', startsWith('silpo'), 'SILPO', true],
    ['M26 nameIs refuses a blank description', nameIs('x'), '', false],
    ['M26 nameIs refuses a null description', nameIs('x'), null, false],
    ['starts with refuses a blank description', startsWith('x'), '   ', false],
  ])('%s', (_label, matcher, description, expected) => {
    expect(matches([matcher], named(description))).toBe(expected);
  });

  it('a name rule and an amount rule both have to hold', () => {
    expect(matches([nameIs('silpo'), amountRule('gt', 100)], named('Silpo'))).toBe(false);
  });
});
