import { prepareRules } from './prepare-rules';
import { ruleRow } from './__fixtures__/rule-row';
import { canEverMatch, matcherSetKey, validateRule } from './validate-rule';
import type { AmountOperator, CategoryRuleMatcher, PreparedRule } from './category-rules.d';

const nameIs = (text: string): CategoryRuleMatcher => ({ type: 'nameIs', text });
const startsWith = (text: string): CategoryRuleMatcher => ({ type: 'nameStartsWith', text });
const direction = (value: 'expense' | 'income'): CategoryRuleMatcher => ({
  type: 'direction',
  direction: value,
});
const amount = (
  operator: AmountOperator,
  minorUnits: number,
  currency: 'UAH' | 'USD' = 'UAH',
): CategoryRuleMatcher => ({ type: 'amount', operator, minorUnits, currency });
const clockBefore = (hour: number, minute = 0): CategoryRuleMatcher => ({
  type: 'time',
  operator: 'before',
  minuteOfDay: hour * 60 + minute,
});
const clockAfter = (hour: number, minute = 0): CategoryRuleMatcher => ({
  type: 'time',
  operator: 'after',
  minuteOfDay: hour * 60 + minute,
});

const preparedOf = (...rows: Parameters<typeof ruleRow>[0][]): readonly PreparedRule[] =>
  prepareRules(rows.map(ruleRow)).ordered;

describe('canEverMatch', () => {
  it.each([
    ['two directions that differ', [direction('expense'), direction('income')]],
    ['amounts in two currencies', [amount('gt', 1, 'UAH'), amount('lt', 100, 'USD')]],
    ['eq against a different eq', [amount('eq', 5), amount('eq', 6)]],
    ['eq against a gt it does not exceed', [amount('eq', 5), amount('gt', 5)]],
    ['eq against an lt it reaches', [amount('eq', 5), amount('lt', 5)]],
    ['gt against an lt with nothing between', [amount('gt', 5), amount('lt', 6)]],
    ['gt against an lte at the same value', [amount('gt', 5), amount('lte', 5)]],
    ['gte above an lte', [amount('gte', 10), amount('lte', 9)]],
    ['gte against an lt at the same value', [amount('gte', 5), amount('lt', 5)]],
    ['gt above an lt', [amount('gt', 10), amount('lt', 5)]],
    ['lt 0 alone', [amount('lt', 0)]],
    ['lt 0 beside a direction-free range', [amount('lt', 0), amount('gte', 0)]],
    ['a zero-only amount beside a direction (eq 0)', [amount('eq', 0), direction('expense')]],
    ['a zero-only amount beside a direction (lte 0)', [amount('lte', 0), direction('income')]],
    ['a zero-only amount beside a direction (lt 1)', [amount('lt', 1), direction('expense')]],
    [
      'a zero-only range built from two operators',
      [amount('gte', 0), amount('lt', 1), direction('income')],
    ],
    ['after later than before', [clockAfter(22), clockBefore(6)]],
    ['after equal to before', [clockAfter(12), clockBefore(12)]],
    ['before 00:00 alone', [clockBefore(0)]],
    ['before 00:00 beside an after', [clockBefore(0), clockAfter(0)]],
    ['two nameIs with different text', [nameIs('silpo'), nameIs('atb')]],
    ['a nameIs not starting with the prefix', [nameIs('silpo'), startsWith('atb')]],
    ['a nameIs shorter than the prefix', [nameIs('sil'), startsWith('silpo')]],
    ['two prefixes where neither starts the other', [startsWith('silpo'), startsWith('atb')]],
    [
      'an impossible pair hidden among possible matchers',
      [nameIs('silpo'), direction('expense'), clockAfter(22), clockBefore(6), amount('gt', 1)],
    ],
  ])('is false for %s', (_label, matchers) => {
    expect(canEverMatch(matchers)).toBe(false);
  });

  it.each([
    ['a single name matcher', [nameIs('silpo')]],
    ['one direction repeated', [direction('income'), direction('income')]],
    ['a direction beside a range above zero', [amount('gt', 0), direction('expense')]],
    ['a zero-only amount without a direction', [amount('eq', 0)]],
    ['lte 0 without a direction', [amount('lte', 0)]],
    ['a direction beside gte 0', [amount('gte', 0), direction('income')]],
    ['one currency repeated', [amount('gt', 1), amount('lt', 100)]],
    ['gt against an lt with one integer between', [amount('gt', 5), amount('lt', 7)]],
    ['gte against an lte at the same value', [amount('gte', 5), amount('lte', 5)]],
    ['eq inside a gte and lte range', [amount('gte', 1), amount('eq', 5), amount('lte', 9)]],
    ['lt 1', [amount('lt', 1)]],
    ['after before an earlier before', [clockAfter(6), clockBefore(22)]],
    ['a window of one minute', [clockAfter(6), clockBefore(6, 1)]],
    ['after 23:59', [clockAfter(23, 59)]],
    ['before 23:59', [clockBefore(23, 59)]],
    ['a nameIs inside a prefix', [nameIs('Silpo Market'), startsWith('  SILPO')]],
    ['the same nameIs in another case', [nameIs('Silpo'), nameIs(' SILPO ')]],
    ['nested prefixes', [startsWith('sil'), startsWith('Silpo')]],
    [
      'every matcher type together',
      [nameIs('silpo'), amount('gt', 1), direction('expense'), clockAfter(6)],
    ],
  ])('is true for %s', (_label, matchers) => {
    expect(canEverMatch(matchers)).toBe(true);
  });
});

describe('matcherSetKey', () => {
  it('ignores matcher order', () => {
    expect(matcherSetKey([nameIs('silpo'), direction('expense'), clockAfter(6)])).toBe(
      matcherSetKey([clockAfter(6), nameIs('silpo'), direction('expense')]),
    );
  });

  it('normalizes names', () => {
    expect(matcherSetKey([nameIs('  SILPO  ')])).toBe(matcherSetKey([nameIs('silpo')]));
    expect(matcherSetKey([startsWith('Сільпо')])).toBe(matcherSetKey([startsWith('СІЛЬПО')]));
  });

  it.each([
    ['nameIs against nameStartsWith', [nameIs('silpo')], [startsWith('silpo')]],
    ['different name text', [nameIs('silpo')], [nameIs('atb')]],
    ['different operators', [amount('gt', 5)], [amount('gte', 5)]],
    ['different amounts', [amount('gt', 5)], [amount('gt', 6)]],
    ['different currencies', [amount('gt', 5, 'UAH')], [amount('gt', 5, 'USD')]],
    ['different directions', [direction('expense')], [direction('income')]],
    ['before against after', [clockBefore(6)], [clockAfter(6)]],
    ['different minutes', [clockBefore(6)], [clockBefore(7)]],
    ['a matcher missing', [nameIs('silpo'), direction('expense')], [nameIs('silpo')]],
  ])('differs for %s', (_label, first, second) => {
    expect(matcherSetKey(first)).not.toBe(matcherSetKey(second));
  });

  it('keeps a repeated matcher once', () => {
    expect(matcherSetKey([nameIs('silpo'), nameIs('  SILPO '), direction('expense')])).toBe(
      matcherSetKey([direction('expense'), nameIs('silpo')]),
    );
  });

  it('joins one entry per matcher with a NUL character', () => {
    expect(matcherSetKey([nameIs('a'), nameIs('b')]).split('\u0000')).toHaveLength(2);
  });
});

describe('validateRule', () => {
  it('reports noMatchers for an empty list', () => {
    expect(validateRule([], [], null)).toEqual({ kind: 'noMatchers' });
  });

  it('M23 refuses a window over midnight written as one rule, as a clash of times', () => {
    expect(validateRule([clockAfter(22), clockBefore(6)], [], null)).toEqual({
      kind: 'neverMatches',
      conflict: 'time',
    });
  });

  it.each([
    ['two directions', [direction('expense'), direction('income')]],
    ['two currencies', [amount('gt', 1, 'UAH'), amount('lt', 100, 'USD')]],
    ['an empty amount range', [amount('gt', 10), amount('lt', 5)]],
    ['two different exact names', [nameIs('silpo'), nameIs('atb')]],
  ])('refuses %s as a clash that is not about times', (_label, matchers) => {
    expect(validateRule(matchers, [], null)).toEqual({ kind: 'neverMatches', conflict: 'other' });
  });

  it('names the times when the times clash beside another clash', () => {
    expect(
      validateRule(
        [direction('expense'), direction('income'), clockAfter(22), clockBefore(6)],
        [],
        null,
      ),
    ).toEqual({ kind: 'neverMatches', conflict: 'time' });
  });

  it('M23 accepts each half of that window as its own rule', () => {
    expect(validateRule([clockAfter(22)], [], null)).toEqual({ kind: 'valid' });
    expect(validateRule([clockBefore(6)], [], null)).toEqual({ kind: 'valid' });
  });

  it('reports neverMatches ahead of a duplicate', () => {
    const others = preparedOf({
      id: 'other',
      matchers: [direction('income'), direction('expense')],
    });

    expect(validateRule([direction('income'), direction('expense')], others, null)).toEqual({
      kind: 'neverMatches',
      conflict: 'other',
    });
  });

  it('names the category of a duplicate whose matchers come in another order and case', () => {
    const others = preparedOf({
      id: 'other',
      category: 'shops',
      matchers: [nameIs('Silpo'), direction('expense')],
    });

    expect(validateRule([direction('expense'), nameIs('  SILPO ')], others, null)).toEqual({
      kind: 'duplicate',
      category: 'shops',
    });
  });

  it('names the category of a rule whose only difference is a repeated matcher', () => {
    const others = preparedOf({ id: 'food', category: 'food', matchers: [nameIs('Silpo')] });

    expect(validateRule([nameIs('silpo'), nameIs('SILPO')], others, null)).toEqual({
      kind: 'duplicate',
      category: 'food',
    });
  });

  it('finds the duplicate when the other rule is the one with the repeated matcher', () => {
    const others = preparedOf({
      id: 'repeated',
      category: 'shops',
      matchers: [nameIs('Silpo'), nameIs('silpo')],
    });

    expect(validateRule([nameIs('silpo')], others, null)).toEqual({
      kind: 'duplicate',
      category: 'shops',
    });
  });

  it('does not treat the rule being edited as a duplicate of itself', () => {
    const others = preparedOf({ id: 'own', matchers: [nameIs('silpo')] });

    expect(validateRule([nameIs('silpo')], others, 'own')).toEqual({ kind: 'valid' });
  });

  it('still finds a duplicate among other rules while editing one', () => {
    const others = preparedOf(
      { id: 'own', category: 'food', matchers: [nameIs('silpo')] },
      { id: 'twin', category: 'shops', matchers: [nameIs('silpo')] },
    );

    expect(validateRule([nameIs('silpo')], others, 'own')).toEqual({
      kind: 'duplicate',
      category: 'shops',
    });
  });

  it('treats a new rule (no own id) as a duplicate of any rule with the same set', () => {
    const others = preparedOf({ id: 'other', category: 'food', matchers: [nameIs('silpo')] });

    expect(validateRule([nameIs('silpo')], others, null)).toEqual({
      kind: 'duplicate',
      category: 'food',
    });
  });

  it('accepts a rule whose matcher set differs from every other rule', () => {
    const others = preparedOf(
      { id: 'a', matchers: [nameIs('silpo')] },
      { id: 'b', matchers: [nameIs('silpo'), direction('expense')] },
    );

    expect(validateRule([nameIs('silpo'), direction('income')], others, null)).toEqual({
      kind: 'valid',
    });
  });
});
