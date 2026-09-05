import {
  buildCategoryDisplayMap,
  NEUTRAL_CATEGORY,
  resolveCategoryDisplay,
} from './category-display';

describe('buildCategoryDisplayMap', () => {
  it('keys each category display by its stable key, carrying its stored color', () => {
    const map = buildCategoryDisplayMap([
      { key: 'groceries', title: 'Groceries', icon: 'cart', color: '#FFCC00' },
      { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
    ]);

    expect(map.get('groceries')).toEqual({ title: 'Groceries', icon: 'cart', color: '#FFCC00' });
    expect(map.get('other')).toEqual({ title: 'Other', icon: 'square.grid.2x2', color: null });
  });
});

describe('resolveCategoryDisplay', () => {
  const byKey = buildCategoryDisplayMap([
    { key: 'groceries', title: 'Groceries', icon: 'cart' },
    { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
    { key: 'shopping', title: 'Shopping', icon: 'bag' },
  ]);

  const OTHER = { title: 'Other', icon: 'square.grid.2x2', color: null };
  const SHOPPING = { title: 'Shopping', icon: 'bag', color: null };

  it('resolves a stored category (case-insensitively) to its display', () => {
    expect(resolveCategoryDisplay('Groceries', byKey, 'other')).toEqual({
      title: 'Groceries',
      icon: 'cart',
      color: null,
    });
  });

  it('folds an unknown category into the default category', () => {
    expect(resolveCategoryDisplay('NoSuchCategory', byKey, 'other')).toEqual(OTHER);
  });

  it('folds a null category into the default category (no separate Uncategorized bucket)', () => {
    expect(resolveCategoryDisplay(null, byKey, 'other')).toEqual(OTHER);
  });

  it('folds an empty category into the default category', () => {
    expect(resolveCategoryDisplay('', byKey, 'other')).toEqual(OTHER);
  });

  it('folds null and unknown into the CONFIGURED default, not a hardcoded "other"', () => {
    expect(resolveCategoryDisplay(null, byKey, 'shopping')).toEqual(SHOPPING);
    expect(resolveCategoryDisplay('NoSuch', byKey, 'shopping')).toEqual(SHOPPING);
  });

  it('returns the neutral category when neither the key nor the default resolves', () => {
    const empty = buildCategoryDisplayMap([]);

    expect(resolveCategoryDisplay('Groceries', empty, 'other')).toEqual(NEUTRAL_CATEGORY);
    expect(resolveCategoryDisplay(null, empty, 'other')).toEqual(NEUTRAL_CATEGORY);
  });
});
