import {
  type CategoryRuleMatcher,
  prepareRules,
  type StoredCategoryRule,
} from '@kiko/categories/category-rules';

import {
  type CategoryDraft,
  categoryForDraft,
  offersCategoryNameRule,
  resolvePrefixConfirm,
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

  it('gives none for a blank description to a rule on a name, even a name it starts with', () => {
    const named = prepareRules([ruleOf('starts', [{ type: 'nameStartsWith', text: 's' }])]);

    expect(categoryForDraft(draftOf({ description: '' }), named)).toBeNull();
  });

  it('gives none in exchange mode even for a name a rule matches', () => {
    expect(categoryForDraft(draftOf({ mode: 'exchange' }), prepared)).toBeNull();
  });
});

describe('offersCategoryNameRule', () => {
  it.each([
    ['an edit that changed the category', { categoryChanged: true, isEditing: true }, false, true],
    [
      'a create whose category the user picked',
      { categoryChanged: true, isEditing: false },
      true,
      true,
    ],
    [
      'a create whose category the rules pre-selected',
      { categoryChanged: true, isEditing: false },
      false,
      false,
    ],
    ['an edit that kept its category', { categoryChanged: false, isEditing: true }, true, false],
  ])('for %s', (_label, flags, userPickedCategory, expected) => {
    expect(
      offersCategoryNameRule({
        ...flags,
        userPickedCategory,
        effectiveCategory: 'dining',
        ruleCategory: null,
      }),
    ).toBe(expected);
  });

  it.each([
    ['a create pick equal to the rule category', false, 'dining', 'dining', false],
    ['an edit equal to the rule category', true, 'dining', 'dining', true],
    ['a create pick equal to it but for case', false, 'Dining', 'dining', false],
    ['an edit equal to it but for case', true, 'dining', 'Dining', true],
    ['a create pick that differs from the rule category', false, 'groceries', 'dining', true],
    ['an edit that differs from the rule category', true, 'groceries', 'dining', true],
    ['a create pick when no rule gives a category', false, 'dining', null, true],
    ['a create with no category held while a rule gives one', false, null, 'dining', true],
    ['an edit when no rule gives a category', true, 'dining', null, true],
  ])('for %s', (_label, isEditing, effectiveCategory, ruleCategory, expected) => {
    expect(
      offersCategoryNameRule({
        categoryChanged: true,
        isEditing,
        userPickedCategory: true,
        effectiveCategory,
        ruleCategory,
      }),
    ).toBe(expected);
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

describe('resolvePrefixConfirm', () => {
  const buildMessage = jest.fn(
    (preview: { count: number }, categoryTitle: string) =>
      `${preview.count} move to ${categoryTitle}`,
  );
  const actions = { onConfirm: jest.fn(), onBack: jest.fn(), isApplying: false };

  beforeEach(() => {
    buildMessage.mockClear();
  });

  it.each([
    ['no preview is shown', null, { title: 'Dining' }],
    ['no category is pending', { count: 2, names: ['ATB 0212'] }, null],
  ])('gives no step when %s', (_label, preview, pendingCategory) => {
    expect(resolvePrefixConfirm(preview, pendingCategory, buildMessage, actions)).toBeNull();
    expect(buildMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['rows move', 2, true],
    ['one row moves', 1, true],
    ['no row moves', 0, false],
  ])('builds the step with the category title when %s', (_label, count, hasRowsToMove) => {
    const preview = { count, names: [] };

    expect(resolvePrefixConfirm(preview, { title: 'Dining' }, buildMessage, actions)).toEqual({
      message: `${count} move to Dining`,
      hasRowsToMove,
      ...actions,
    });
    expect(buildMessage).toHaveBeenCalledWith(preview, 'Dining');
  });

  it('hands each action to its own slot and the applying flag through', () => {
    const onConfirm = jest.fn();
    const onBack = jest.fn();
    const step = resolvePrefixConfirm({ count: 2, names: [] }, { title: 'Dining' }, buildMessage, {
      onConfirm,
      onBack,
      isApplying: true,
    });

    step?.onConfirm();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();

    step?.onBack();

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(step?.isApplying).toBe(true);
  });
});
