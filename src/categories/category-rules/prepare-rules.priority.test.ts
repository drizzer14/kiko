import { ruleRow } from './__fixtures__/rule-row';
import { subjectOfStoredRow } from './rule-subject';
import { candidateRules, prepareRules, winningRule } from './prepare-rules';
import type { CategoryRuleMatcher, StoredCategoryRule } from './category-rules.d';

const nameIs = (text: string): CategoryRuleMatcher => ({ type: 'nameIs', text });
const nameStartsWith = (text: string): CategoryRuleMatcher => ({ type: 'nameStartsWith', text });
const expenseOnly: CategoryRuleMatcher = { type: 'direction', direction: 'expense' };

const silpoSubject = (description = 'Silpo') =>
  subjectOfStoredRow({
    description,
    amountMinorUnits: -10000,
    time: new Date(2026, 5, 1, 12, 0).getTime(),
    currency: 'UAH',
  });

const winnerIdOf = (rows: readonly StoredCategoryRule[], description = 'Silpo') =>
  winningRule(prepareRules(rows), silpoSubject(description))?.id;

describe('rule priority', () => {
  it('P1 two matchers beat one, though the rule with two is older', () => {
    const rows = [
      ruleRow({ id: 'one', category: 'food', matchers: [nameIs('silpo')], updatedAt: 900 }),
      ruleRow({
        id: 'two',
        category: 'shops',
        matchers: [nameIs('silpo'), expenseOnly],
        updatedAt: 100,
      }),
    ];

    expect(winnerIdOf(rows)).toBe('two');
    expect(winnerIdOf([...rows].reverse())).toBe('two');
  });

  it('three matchers beat two', () => {
    const rows = [
      ruleRow({ id: 'two', matchers: [nameIs('silpo'), expenseOnly], updatedAt: 900 }),
      ruleRow({
        id: 'three',
        matchers: [
          nameIs('silpo'),
          expenseOnly,
          { type: 'amount', operator: 'gt', minorUnits: 0, currency: 'UAH' },
        ],
        updatedAt: 100,
      }),
    ];

    expect(winnerIdOf(rows)).toBe('three');
  });

  it('P2 with equal matcher counts the later updatedAt wins', () => {
    const rows = [
      ruleRow({ id: 'older', category: 'food', matchers: [nameIs('silpo')], updatedAt: 100 }),
      ruleRow({ id: 'newer', category: 'shops', matchers: [nameIs('silpo')], updatedAt: 200 }),
    ];

    expect(winnerIdOf(rows)).toBe('newer');
    expect(winnerIdOf([...rows].reverse())).toBe('newer');
  });

  it('P2 updatedAt outranks createdAt when the two disagree', () => {
    const rows = [
      ruleRow({
        id: 'created-later',
        category: 'food',
        matchers: [nameIs('silpo')],
        createdAt: 300,
        updatedAt: 100,
      }),
      ruleRow({
        id: 'updated-later',
        category: 'shops',
        matchers: [nameIs('silpo')],
        createdAt: 200,
        updatedAt: 500,
      }),
    ];

    expect(winnerIdOf(rows)).toBe('updated-later');
    expect(winnerIdOf([...rows].reverse())).toBe('updated-later');
  });

  it('ranks a stored rule with a repeated matcher by its distinct matchers', () => {
    const rows = [
      ruleRow({
        id: 'repeated',
        category: 'shops',
        matchers: [nameIs('silpo'), nameIs(' SILPO ')],
        updatedAt: 100,
      }),
      ruleRow({ id: 'single', category: 'food', matchers: [nameIs('silpo')], updatedAt: 200 }),
    ];

    expect(winnerIdOf(rows)).toBe('single');
    expect(winnerIdOf([...rows].reverse())).toBe('single');
  });

  it('counts two different matchers of one kind as two', () => {
    const rows = [
      ruleRow({
        id: 'two-prefixes',
        matchers: [nameStartsWith('sil'), nameStartsWith('silp')],
        updatedAt: 100,
      }),
      ruleRow({ id: 'single', matchers: [nameIs('silpo')], updatedAt: 200 }),
    ];

    expect(winnerIdOf(rows)).toBe('two-prefixes');
  });

  it('P3 with equal updatedAt the later createdAt wins', () => {
    const rows = [
      ruleRow({
        id: 'first',
        category: 'food',
        matchers: [nameIs('silpo')],
        createdAt: 300,
        updatedAt: 500,
      }),
      ruleRow({
        id: 'second',
        category: 'shops',
        matchers: [nameIs('silpo')],
        createdAt: 200,
        updatedAt: 500,
      }),
    ];

    expect(winnerIdOf(rows)).toBe('first');
    expect(winnerIdOf([...rows].reverse())).toBe('first');
  });

  it('P4 with every timestamp equal the larger id string wins', () => {
    const rows = [
      ruleRow({ id: 'rule-a', category: 'food', matchers: [nameIs('silpo')] }),
      ruleRow({ id: 'rule-b', category: 'shops', matchers: [nameIs('silpo')] }),
    ];

    expect(winnerIdOf(rows)).toBe('rule-b');
    expect(winnerIdOf([...rows].reverse())).toBe('rule-b');
  });

  it('compares ids as strings, not as numbers', () => {
    const rows = [
      ruleRow({ id: '9', matchers: [nameIs('silpo')] }),
      ruleRow({ id: '10', matchers: [nameIs('silpo')] }),
    ];

    expect(winnerIdOf(rows)).toBe('9');
  });

  it('a stronger rule that does not match does not block a weaker one that does', () => {
    const rows = [
      ruleRow({ id: 'strong', matchers: [nameIs('atb'), expenseOnly] }),
      ruleRow({ id: 'weak', matchers: [nameIs('silpo')] }),
    ];

    expect(winnerIdOf(rows)).toBe('weak');
  });

  it('two rules of the same category tie harmlessly', () => {
    const rows = [
      ruleRow({ id: 'a', category: 'food', matchers: [nameIs('silpo')] }),
      ruleRow({ id: 'b', category: 'food', matchers: [nameIs('silpo')] }),
    ];

    expect(winningRule(prepareRules(rows), silpoSubject())?.category).toBe('food');
    expect(winningRule(prepareRules([...rows].reverse()), silpoSubject())?.category).toBe('food');
  });

  it('numbers rank from the strongest rule at 0', () => {
    const prepared = prepareRules([
      ruleRow({ id: 'c', matchers: [nameIs('c')], updatedAt: 1 }),
      ruleRow({ id: 'a', matchers: [nameIs('a'), expenseOnly], updatedAt: 1 }),
      ruleRow({ id: 'b', matchers: [nameIs('b')], updatedAt: 2 }),
    ]);

    expect(prepared.ordered.map((rule) => [rule.id, rule.rank])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('returns nothing when no rule matches', () => {
    expect(winnerIdOf([ruleRow({ matchers: [nameIs('atb')] })])).toBeUndefined();
    expect(winnerIdOf([])).toBeUndefined();
  });
});

describe('unreadable rules', () => {
  const broken: StoredCategoryRule = {
    ...ruleRow({ id: 'zzz', matchers: [nameIs('silpo')] }),
    matchers: '{broken',
  };

  it('lands in unreadable and in no other list', () => {
    const prepared = prepareRules([broken, ruleRow({ id: 'good', matchers: [nameIs('silpo')] })]);

    expect(prepared.unreadable).toEqual([broken]);
    expect(prepared.ordered.map((rule) => rule.id)).toEqual(['good']);
    expect(prepared.withoutName).toEqual([]);
    expect([...prepared.byName.keys()]).toEqual(['silpo']);
  });

  it('never wins, even as the only rule', () => {
    expect(winnerIdOf([broken])).toBeUndefined();
  });

  it('never wins over a readable rule it would have out-ranked', () => {
    const strongest: StoredCategoryRule = {
      ...ruleRow({ id: 'zzzz', matchers: [nameIs('silpo')], updatedAt: 9_999 }),
      matchers: JSON.stringify([
        { type: 'nameIs', text: 'silpo' },
        { type: 'direction', direction: 'sideways' },
      ]),
    };

    expect(winnerIdOf([strongest, ruleRow({ id: 'a', matchers: [nameIs('silpo')] })])).toBe('a');
  });
});

describe('prepared matchers', () => {
  it('keeps the typed text for display and storage beside the normalized one for matching', () => {
    const [rule] = prepareRules([
      ruleRow({ matchers: [nameIs('  Сільпо  Market '), nameStartsWith('SILPO')] }),
    ]).ordered;

    expect(rule?.displayMatchers).toEqual([
      { type: 'nameIs', text: '  Сільпо  Market ' },
      { type: 'nameStartsWith', text: 'SILPO' },
    ]);
    expect(rule?.matchers).toEqual([
      { type: 'nameIs', text: 'сільпо market' },
      { type: 'nameStartsWith', text: 'silpo' },
    ]);
  });
});

describe('prepared indexes', () => {
  it('indexes a rule under the normalized text of its first nameIs matcher', () => {
    const prepared = prepareRules([
      ruleRow({ id: 'indexed', matchers: [expenseOnly, nameIs('  СІЛЬПО '), nameIs('other')] }),
    ]);

    expect([...prepared.byName.keys()]).toEqual(['сільпо']);
    expect(prepared.byName.get('сільпо')?.map((rule) => rule.id)).toEqual(['indexed']);
    expect(prepared.withoutName).toEqual([]);
  });

  it('keeps name starts-with rules and rules with no name matcher in withoutName', () => {
    const prepared = prepareRules([
      ruleRow({ id: 'prefix', matchers: [nameStartsWith('silpo')] }),
      ruleRow({ id: 'direction', matchers: [expenseOnly] }),
      ruleRow({ id: 'named', matchers: [nameIs('silpo')] }),
    ]);

    expect(prepared.withoutName.map((rule) => rule.id).sort()).toEqual(['direction', 'prefix']);
    expect(prepared.ordered).toHaveLength(3);
  });

  it('lists each bucket in priority order', () => {
    const prepared = prepareRules([
      ruleRow({ id: 'late', matchers: [nameIs('silpo')], updatedAt: 1 }),
      ruleRow({ id: 'early', matchers: [nameIs('silpo')], updatedAt: 2 }),
      ruleRow({ id: 'x', matchers: [expenseOnly], updatedAt: 1 }),
      ruleRow({ id: 'y', matchers: [expenseOnly], updatedAt: 2 }),
    ]);

    expect(prepared.byName.get('silpo')?.map((rule) => rule.id)).toEqual(['early', 'late']);
    expect(prepared.withoutName.map((rule) => rule.id)).toEqual(['y', 'x']);
  });
});

describe('candidateRules', () => {
  const prepared = prepareRules([
    ruleRow({ id: 'silpo-name', matchers: [nameIs('silpo')], updatedAt: 5 }),
    ruleRow({ id: 'atb-name', matchers: [nameIs('atb')], updatedAt: 4 }),
    ruleRow({ id: 'prefix', matchers: [nameStartsWith('sil')], updatedAt: 3 }),
    ruleRow({ id: 'direction', matchers: [expenseOnly], updatedAt: 6 }),
  ]);

  it('returns exactly withoutName for a name no nameIs text matches', () => {
    const candidates = candidateRules(prepared, silpoSubject('Rozetka'));

    expect(candidates).toEqual(prepared.withoutName);
    expect(candidates.map((rule) => rule.id)).toEqual(['direction', 'prefix']);
  });

  it('merges the rules of the matching name with withoutName by rank', () => {
    expect(candidateRules(prepared, silpoSubject('SILPO')).map((rule) => rule.id)).toEqual([
      'direction',
      'silpo-name',
      'prefix',
    ]);
  });

  it('returns withoutName for a blank name', () => {
    expect(candidateRules(prepared, silpoSubject('   '))).toEqual(prepared.withoutName);
  });

  it('returns an empty list when there are no rules', () => {
    expect(candidateRules(prepareRules([]), silpoSubject())).toEqual([]);
  });
});
