import {
  NEUTRAL_CATEGORY,
  resolveCategoryDisplay,
  buildCategoryDisplayMap,
} from './category-display';

describe('buildCategoryDisplayMap', () => {
  it('keys each category display by its stable key', () => {
    const map = buildCategoryDisplayMap([
      { key: 'groceries', title: 'Groceries', icon: 'cart' },
      { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
    ]);

    expect(map.get('groceries')).toEqual({ title: 'Groceries', icon: 'cart' });
    expect(map.get('other')).toEqual({ title: 'Other', icon: 'square.grid.2x2' });
  });
});

describe('resolveCategoryDisplay', () => {
  const byKey = buildCategoryDisplayMap([
    { key: 'groceries', title: 'Groceries', icon: 'cart' },
    { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
  ]);

  it('resolves a stored category (case-insensitively) to its display', () => {
    expect(resolveCategoryDisplay('Groceries', byKey)).toEqual({
      title: 'Groceries',
      icon: 'cart',
    });
  });

  it('falls back to the seeded "other" row when the category does not resolve', () => {
    expect(resolveCategoryDisplay('NoSuchCategory', byKey)).toEqual({
      title: 'Other',
      icon: 'square.grid.2x2',
    });
  });

  it('returns the neutral category for a null category', () => {
    expect(resolveCategoryDisplay(null, byKey)).toEqual(NEUTRAL_CATEGORY);
  });

  it('returns the neutral category for an empty category', () => {
    expect(resolveCategoryDisplay('', byKey)).toEqual(NEUTRAL_CATEGORY);
  });

  it('returns the neutral category when neither the key nor "other" resolves', () => {
    const empty = buildCategoryDisplayMap([]);

    expect(resolveCategoryDisplay('Groceries', empty)).toEqual(NEUTRAL_CATEGORY);
  });
});
