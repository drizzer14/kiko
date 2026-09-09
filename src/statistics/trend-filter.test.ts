import type { CategoryMeasure } from './category-trend';
import {
  DEFAULT_TREND_FILTER,
  resolveTrendFilter,
  selectTopCategories,
  type TrendFilter,
} from './trend-filter';

const measure = (over: Partial<CategoryMeasure> & { key: string }): CategoryMeasure => ({
  total: 0,
  count: 0,
  risingSlope: 0,
  ...over,
});

describe('selectTopCategories', () => {
  it('ranks by contribution (total spend) descending', () => {
    const top = selectTopCategories({
      measures: [
        measure({ key: 'a', total: 10 }),
        measure({ key: 'b', total: 30 }),
        measure({ key: 'c', total: 20 }),
      ],
      amount: 2,
      by: 'contribution',
    });

    expect([...top]).toEqual(['b', 'c']);
  });

  it('ranks by frequency (transaction count) descending', () => {
    const top = selectTopCategories({
      measures: [
        measure({ key: 'a', count: 1, total: 999 }),
        measure({ key: 'b', count: 5, total: 1 }),
        measure({ key: 'c', count: 3, total: 1 }),
      ],
      amount: 2,
      by: 'frequency',
    });

    expect([...top]).toEqual(['b', 'c']);
  });

  it('ranks by rising (steepest upward slope) descending', () => {
    const top = selectTopCategories({
      measures: [
        measure({ key: 'a', risingSlope: -5 }),
        measure({ key: 'b', risingSlope: 12 }),
        measure({ key: 'c', risingSlope: 3 }),
      ],
      amount: 2,
      by: 'rising',
    });

    expect([...top]).toEqual(['b', 'c']);
  });

  it('breaks a tie deterministically by key ascending', () => {
    const top = selectTopCategories({
      measures: [
        measure({ key: 'zebra', total: 10 }),
        measure({ key: 'alpha', total: 10 }),
        measure({ key: 'mango', total: 10 }),
      ],
      amount: 2,
      by: 'contribution',
    });

    expect([...top]).toEqual(['alpha', 'mango']);
  });

  it('clamps the amount below 1 up to 1', () => {
    const top = selectTopCategories({
      measures: [measure({ key: 'a', total: 3 }), measure({ key: 'b', total: 2 })],
      amount: 0,
      by: 'contribution',
    });

    expect(top.size).toBe(1);
    expect([...top]).toEqual(['a']);
  });

  it('clamps the amount above 5 down to 5', () => {
    const measures = Array.from({ length: 8 }, (_, index) =>
      measure({ key: `k${index}`, total: 8 - index }),
    );
    const top = selectTopCategories({ measures, amount: 7, by: 'contribution' });

    expect(top.size).toBe(5);
    expect([...top]).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
  });

  it('returns every category when fewer exist than the amount', () => {
    const top = selectTopCategories({
      measures: [measure({ key: 'a', total: 3 }), measure({ key: 'b', total: 2 })],
      amount: 5,
      by: 'contribution',
    });

    expect(top.size).toBe(2);
  });

  it('returns an empty set for no measures', () => {
    expect(selectTopCategories({ measures: [], amount: 3, by: 'contribution' }).size).toBe(0);
  });
});

describe('resolveTrendFilter', () => {
  const existing = new Set(['groceries', 'transport']);

  it('falls back to the default (top / contribution / 3) for a null stored value', () => {
    expect(resolveTrendFilter(null, existing)).toEqual(DEFAULT_TREND_FILTER);
    expect(DEFAULT_TREND_FILTER).toEqual({ mode: 'top', amount: 3, by: 'contribution' });
  });

  it('prunes a manual selection to the categories that still exist', () => {
    const stored: TrendFilter = { mode: 'manual', keys: ['groceries', 'deleted', 'transport'] };

    expect(resolveTrendFilter(stored, existing)).toEqual({
      mode: 'manual',
      keys: ['groceries', 'transport'],
    });
  });

  it('keeps a manual selection that prunes to empty as an empty manual (all categories)', () => {
    const stored: TrendFilter = { mode: 'manual', keys: ['deleted'] };

    expect(resolveTrendFilter(stored, existing)).toEqual({ mode: 'manual', keys: [] });
  });

  it('clamps a stored top amount into the 1..5 range', () => {
    expect(resolveTrendFilter({ mode: 'top', amount: 9, by: 'rising' }, existing)).toEqual({
      mode: 'top',
      amount: 5,
      by: 'rising',
    });
  });
});
