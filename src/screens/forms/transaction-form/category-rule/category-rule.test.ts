import {
  type CategoryRuleMatcher,
  prepareRules,
  type StoredCategoryRule,
} from '@kiko/categories/category-rules';

import {
  type CategoryDraft,
  categoryForDraft,
  resolveCategoryOverrideRequest,
  subjectOfFormDraft,
} from './category-rule';

const MORNING = new Date(2026, 9, 12, 8, 15).getTime();

const draftOf = (overrides: Partial<CategoryDraft> = {}): CategoryDraft => ({
  description: '  Silpo  ',
  amount: '12.50',
  time: MORNING,
  mode: 'expense',
  currency: 'UAH',
  ...overrides,
});

const ruleOf = (id: string, matchers: CategoryRuleMatcher[]): StoredCategoryRule => ({
  id,
  category: 'groceries',
  matchers: JSON.stringify(matchers),
  createdAt: 1,
  updatedAt: 1,
});

describe('subjectOfFormDraft', () => {
  it('reads the whole draft: name, absolute amount, currency, direction and minute of day', () => {
    expect(subjectOfFormDraft(draftOf())).toEqual({
      normalizedName: 'silpo',
      absoluteMinorUnits: 1250,
      currency: 'UAH',
      direction: 'expense',
      minuteOfDay: 8 * 60 + 15,
    });
  });

  it('scales the amount by the holding currency', () => {
    expect(subjectOfFormDraft(draftOf({ amount: '0.0000005', currency: 'BTC' }))).toMatchObject({
      absoluteMinorUnits: 50,
      currency: 'BTC',
    });
  });

  it('reads an income draft as an income', () => {
    expect(subjectOfFormDraft(draftOf({ mode: 'income' }))).toMatchObject({ direction: 'income' });
  });

  it('reads a split draft as the expense its payment is stored as', () => {
    expect(subjectOfFormDraft(draftOf({ mode: 'split' }))).toMatchObject({ direction: 'expense' });
  });

  it('has no subject in exchange mode, which never carries a category', () => {
    expect(subjectOfFormDraft(draftOf({ mode: 'exchange' }))).toBeNull();
  });

  it.each(['', '   ', 'abc'])('leaves the amount unknown for the text %j', (amount) => {
    expect(subjectOfFormDraft(draftOf({ amount }))).toMatchObject({ absoluteMinorUnits: null });
  });

  it('leaves the amount unknown while no holding gives it a currency', () => {
    expect(subjectOfFormDraft(draftOf({ currency: null }))).toMatchObject({
      absoluteMinorUnits: null,
      currency: null,
    });
  });
});

describe('categoryForDraft', () => {
  const prepared = prepareRules([
    ruleOf('large-expense', [
      { type: 'amount', operator: 'gt', minorUnits: 100_000, currency: 'UAH' },
      { type: 'direction', direction: 'expense' },
    ]),
    ruleOf('silpo', [{ type: 'nameIs', text: 'silpo' }]),
  ]);

  it('gives the category of the rule the whole draft matches', () => {
    expect(categoryForDraft(draftOf({ description: '', amount: '1500' }), prepared)).toBe(
      'groceries',
    );
  });

  it('gives none when the draft matches no rule', () => {
    expect(categoryForDraft(draftOf({ description: 'Other', amount: '15' }), prepared)).toBeNull();
  });

  it('gives none in exchange mode even for a name a rule matches', () => {
    expect(categoryForDraft(draftOf({ mode: 'exchange' }), prepared)).toBeNull();
  });
});

describe('resolveCategoryOverrideRequest', () => {
  it('asks to apply the picked category to a name, naming the row the rule frees', () => {
    expect(resolveCategoryOverrideRequest(true, 'dining', 'Coffee', 'created-row')).toEqual({
      name: 'Coffee',
      category: 'dining',
      sourceTransactionId: 'created-row',
    });
  });

  it('names no source row when none was written', () => {
    expect(resolveCategoryOverrideRequest(true, 'dining', 'Coffee', null)).toEqual({
      name: 'Coffee',
      category: 'dining',
      sourceTransactionId: null,
    });
  });

  it.each([
    ['the category did not change', false, 'dining', 'Coffee'],
    ['no category is picked', true, null, 'Coffee'],
    ['the name is blank', true, 'dining', '   '],
  ])('asks nothing when %s', (_label, changed, category, name) => {
    expect(resolveCategoryOverrideRequest(changed, category, name, 'row')).toBeNull();
  });
});
