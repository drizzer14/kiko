import { exchangeExcludedTransactionIds } from '@kiko/statistics/exchange-exclusion';

import {
  REWRITE_GUARD_FIELDS,
  type RewriteGuardField,
  isRewriteEligible,
  planRuleRewrite,
} from './plan-rule-rewrite';
import { prepareRules } from './prepare-rules';
import { ruleRow } from './__fixtures__/rule-row';
import type { CategoryRuleMatcher, RewriteCandidate } from './category-rules.d';

const nameIs = (text: string): CategoryRuleMatcher => ({ type: 'nameIs', text });

const candidate = (overrides: Partial<RewriteCandidate> = {}): RewriteCandidate => ({
  id: 'row-1',
  description: 'Silpo',
  amountMinorUnits: -10000,
  time: new Date(2026, 5, 1, 12, 0).getTime(),
  currency: 'UAH',
  category: 'groceries',
  categorySetByHand: false,
  exchangePairId: null,
  exchangeCounterpartHoldingId: null,
  untrackedCounterpart: null,
  setsBalance: false,
  changeGroupId: null,
  ...overrides,
});

const savedFood = ruleRow({ id: 'saved', category: 'food', matchers: [nameIs('silpo')] });

describe('isRewriteEligible', () => {
  it('accepts a plain row', () => {
    expect(isRewriteEligible(candidate())).toBe(true);
  });

  it.each([
    ['a hand-picked category', { categorySetByHand: true }],
    ['an exchange pair', { exchangePairId: 'pair-1' }],
    ['an exchange counterpart holding', { exchangeCounterpartHoldingId: 'holding-2' }],
    ['an untracked counterpart wallet', { untrackedCounterpart: 'wallet:UMFUTURE' }],
    ['a balance-setting row', { setsBalance: true }],
    ['a split-change row', { changeGroupId: 'group-1' }],
  ])('refuses %s', (_label, overrides) => {
    expect(isRewriteEligible(candidate(overrides))).toBe(false);
  });
});

// The refresh at insert (`transactions.repo.ts`) builds its SQL from this same list, so the list is
// the one definition of "a row a rule may not rewrite".
describe('REWRITE_GUARD_FIELDS', () => {
  const SET_VALUE: Record<RewriteGuardField, Partial<RewriteCandidate>> = {
    categorySetByHand: { categorySetByHand: true },
    exchangePairId: { exchangePairId: 'pair-1' },
    exchangeCounterpartHoldingId: { exchangeCounterpartHoldingId: 'holding-2' },
    untrackedCounterpart: { untrackedCounterpart: 'wallet:UMFUTURE' },
    setsBalance: { setsBalance: true },
    changeGroupId: { changeGroupId: 'group-1' },
  };

  it.each(REWRITE_GUARD_FIELDS)('keeps a row out of a rewrite once %s is set', (field) => {
    expect(isRewriteEligible(candidate(SET_VALUE[field]))).toBe(false);
  });

  it('is every field the eligibility reads, and nothing else', () => {
    const readFields = new Set<string | symbol>();
    const watched = new Proxy(candidate(), {
      get: (target, field: keyof RewriteCandidate) => {
        readFields.add(field);

        return target[field];
      },
    });

    isRewriteEligible(watched);

    expect([...readFields].sort()).toEqual([...REWRITE_GUARD_FIELDS].sort());
  });

  // The statistics treat a row with one of these markers as an exchange leg, and a rule never
  // rewrites an exchange leg, so a marker added there without a guard here leaks a leg to a rule.
  it('names every structural marker the exchange exclusion reads', () => {
    const markersRead = new Set<string | symbol>();
    const row = { id: 'row-1', exchangeCounterpartHoldingId: null, untrackedCounterpart: null };
    const watched = new Proxy(row, {
      get: (target, field: keyof typeof row) => {
        markersRead.add(field);

        return target[field];
      },
    });
    const guardFields: readonly (string | symbol)[] = REWRITE_GUARD_FIELDS;

    exchangeExcludedTransactionIds([watched]);

    expect(markersRead.size).toBeGreaterThan(0);
    expect(
      [...markersRead].filter((marker) => marker !== 'id' && !guardFields.includes(marker)),
    ).toEqual([]);
  });
});

describe('planRuleRewrite', () => {
  it('leaves a flagged row alone', () => {
    const plan = planRuleRewrite(prepareRules([savedFood]), 'saved', [
      candidate({ id: 'flagged', categorySetByHand: true }),
    ]);

    expect(plan).toEqual([]);
  });

  it('plans a row the saved rule wins when its category differs', () => {
    const plan = planRuleRewrite(prepareRules([savedFood]), 'saved', [
      candidate({ id: 'differs', category: 'groceries' }),
      candidate({ id: 'uncategorized', category: null }),
    ]);

    expect(plan).toEqual(['differs', 'uncategorized']);
  });

  it('skips a row that already has the saved rule category', () => {
    const plan = planRuleRewrite(prepareRules([savedFood]), 'saved', [
      candidate({ id: 'same', category: 'food' }),
    ]);

    expect(plan).toEqual([]);
  });

  it('skips a row whose category key differs from the rule category only in case', () => {
    const plan = planRuleRewrite(prepareRules([savedFood]), 'saved', [
      candidate({ id: 'capitalized', category: 'Food' }),
    ]);

    expect(plan).toEqual([]);
  });

  it('skips a row a stronger rule wins', () => {
    const stronger = ruleRow({
      id: 'stronger',
      category: 'shops',
      matchers: [nameIs('silpo'), { type: 'direction', direction: 'expense' }],
    });
    const prepared = prepareRules([savedFood, stronger]);

    expect(planRuleRewrite(prepared, 'saved', [candidate()])).toEqual([]);
    expect(planRuleRewrite(prepared, 'stronger', [candidate()])).toEqual(['row-1']);
  });

  it('skips a row a newer rule of equal strength wins', () => {
    const newer = ruleRow({
      id: 'newer',
      category: 'shops',
      matchers: [nameIs('silpo')],
      updatedAt: 50,
    });

    expect(planRuleRewrite(prepareRules([savedFood, newer]), 'saved', [candidate()])).toEqual([]);
  });

  it('does not plan a row the narrowed rule no longer matches', () => {
    const narrowed = ruleRow({
      id: 'saved',
      category: 'food',
      matchers: [
        nameIs('silpo'),
        { type: 'amount', operator: 'gt', minorUnits: 50000, currency: 'UAH' },
      ],
    });

    const plan = planRuleRewrite(prepareRules([narrowed]), 'saved', [
      candidate({ id: 'previously-set', category: 'food', amountMinorUnits: -10000 }),
      candidate({ id: 'still-matches', category: 'groceries', amountMinorUnits: -60000 }),
      candidate({ id: 'set-by-it-once', category: 'groceries', amountMinorUnits: -10000 }),
    ]);

    expect(plan).toEqual(['still-matches']);
  });

  it('returns nothing when the saved rule is absent', () => {
    const plan = planRuleRewrite(prepareRules([savedFood]), 'deleted', [candidate()]);

    expect(plan).toEqual([]);
  });

  it('returns nothing when the saved rule is unreadable', () => {
    const unreadable = { ...savedFood, matchers: 'not json' };

    expect(planRuleRewrite(prepareRules([unreadable]), 'saved', [candidate()])).toEqual([]);
  });

  it.each([
    ['an exchange pair', { exchangePairId: 'pair-1' }],
    ['an exchange counterpart holding', { exchangeCounterpartHoldingId: 'holding-2' }],
    ['an untracked counterpart wallet', { untrackedCounterpart: 'wallet:UMFUTURE' }],
    ['a balance-setting row', { setsBalance: true }],
    ['a split-change row', { changeGroupId: 'group-1' }],
  ])('skips %s', (_label, overrides) => {
    const plan = planRuleRewrite(prepareRules([savedFood]), 'saved', [candidate(overrides)]);

    expect(plan).toEqual([]);
  });

  it('keeps the order of the rows it plans and skips the others', () => {
    const plan = planRuleRewrite(prepareRules([savedFood]), 'saved', [
      candidate({ id: 'a' }),
      candidate({ id: 'other-name', description: 'ATB' }),
      candidate({ id: 'b' }),
      candidate({ id: 'already', category: 'food' }),
      candidate({ id: 'c' }),
    ]);

    expect(plan).toEqual(['a', 'b', 'c']);
  });

  it('evaluates a row with the currency of its holding', () => {
    const usdRule = ruleRow({
      id: 'saved',
      category: 'food',
      matchers: [{ type: 'amount', operator: 'eq', minorUnits: 10000, currency: 'USD' }],
    });

    const plan = planRuleRewrite(prepareRules([usdRule]), 'saved', [
      candidate({ id: 'uah', currency: 'UAH' }),
      candidate({ id: 'usd', currency: 'USD' }),
      candidate({ id: 'none', currency: null }),
    ]);

    expect(plan).toEqual(['usd']);
  });
});
