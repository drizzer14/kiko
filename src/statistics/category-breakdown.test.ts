import { buildCategoryDisplayMap } from '../categories/category-display';
import { darkTheme } from '../design-system/theme';
import {
  type BreakdownTransaction,
  buildCategoryBreakdown,
  categoryColor,
  resolveCategoryColor,
} from './category-breakdown';

const DISPLAY = buildCategoryDisplayMap([
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'transport', title: 'Transport', icon: 'car' },
  { key: 'salary', title: 'Salary', icon: 'banknote' },
]);

const tx = (over: Partial<BreakdownTransaction>): BreakdownTransaction => ({
  category: 'groceries',
  amountMinorUnits: -10_00,
  currency: 'UAH',
  ...over,
});

describe('buildCategoryBreakdown', () => {
  it('sums the magnitude of expense (negative) transactions per category, in base minor units', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        tx({ category: 'groceries', amountMinorUnits: -30_00 }),
        tx({ category: 'groceries', amountMinorUnits: -20_00 }),
        tx({ category: 'transport', amountMinorUnits: -40_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
    });

    // transport (40_00) sorts before groceries (50_00)? No: groceries 50_00 > transport 40_00.
    expect(slices.map((slice) => slice.key)).toEqual(['groceries', 'transport']);
    expect(slices.map((slice) => slice.amount)).toEqual([50_00, 40_00]);
  });

  it('excludes income (positive) transactions entirely', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        tx({ category: 'salary', amountMinorUnits: 100_00 }),
        tx({ category: 'groceries', amountMinorUnits: -25_00 }),
        tx({ category: 'groceries', amountMinorUnits: 5_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
    });

    expect(slices.map((slice) => slice.key)).toEqual(['groceries']);
    expect(slices[0].amount).toBe(25_00);
  });

  it('derives shares over the visible slices that sum to ~1', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        tx({ category: 'groceries', amountMinorUnits: -75_00 }),
        tx({ category: 'transport', amountMinorUnits: -25_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
    });

    expect(slices[0].share).toBeCloseTo(0.75, 6);
    expect(slices[1].share).toBeCloseTo(0.25, 6);
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1, 6);
  });

  it('converts a foreign-currency expense into the base currency at the rate table', () => {
    const slices = buildCategoryBreakdown({
      transactions: [tx({ category: 'groceries', amountMinorUnits: -10_00, currency: 'USD' })],
      categoryDisplay: DISPLAY,
      rateTable: { 'USD:UAH': 40 },
      baseCurrency: 'UAH',
    });

    // 10 USD * 40 = 400 UAH = 400_00 minor units.
    expect(slices[0].amount).toBe(400_00);
  });

  it('silently drops an expense whose currency has no rate to the base', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        tx({ category: 'groceries', amountMinorUnits: -10_00, currency: 'EUR' }),
        tx({ category: 'transport', amountMinorUnits: -20_00, currency: 'UAH' }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
    });

    expect(slices.map((slice) => slice.key)).toEqual(['transport']);
  });

  it('groups a null category under a stable "uncategorized" key with the neutral display', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        tx({ category: null, amountMinorUnits: -10_00 }),
        tx({ category: null, amountMinorUnits: -5_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
    });

    expect(slices).toHaveLength(1);
    expect(slices[0].key).toBe('uncategorized');
    expect(slices[0].title).toBe('Uncategorized');
    expect(slices[0].amount).toBe(15_00);
  });

  it('resolves each slice title and icon through the display map', () => {
    const slices = buildCategoryBreakdown({
      transactions: [tx({ category: 'transport', amountMinorUnits: -10_00 })],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
    });

    expect(slices[0].title).toBe('Transport');
    expect(slices[0].icon).toBe('car');
  });

  it('excludes the categories named in excludedCategories and reshares the remainder', () => {
    const input = {
      transactions: [
        tx({ category: 'groceries', amountMinorUnits: -75_00 }),
        tx({ category: 'transport', amountMinorUnits: -25_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH' as const,
    };

    const slices = buildCategoryBreakdown({
      ...input,
      excludedCategories: new Set(['transport']),
    });

    expect(slices.map((slice) => slice.key)).toEqual(['groceries']);
    // The lone remaining slice reshares to the whole of the visible total.
    expect(slices[0].share).toBeCloseTo(1, 6);
  });

  it('colors a slice from the category stored color when set, else the palette hash', () => {
    const colored = buildCategoryDisplayMap([
      { key: 'groceries', title: 'Groceries', icon: 'cart', color: '#123456' },
      { key: 'transport', title: 'Transport', icon: 'car' },
    ]);

    const slices = buildCategoryBreakdown({
      transactions: [
        tx({ category: 'groceries', amountMinorUnits: -10_00 }),
        tx({ category: 'transport', amountMinorUnits: -10_00 }),
      ],
      categoryDisplay: colored,
      rateTable: {},
      baseCurrency: 'UAH',
    });

    const byKey = new Map(slices.map((slice) => [slice.key, slice.color]));
    expect(byKey.get('groceries')).toBe('#123456');
    expect(byKey.get('transport')).toBe(categoryColor('transport'));
  });

  it('colors each slice from the shared chart palette, stably per category key', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        tx({ category: 'groceries', amountMinorUnits: -10_00 }),
        tx({ category: 'transport', amountMinorUnits: -10_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
    });

    for (const slice of slices) {
      expect(darkTheme.colors.chartSeries).toContain(slice.color);
      expect(slice.color).toBe(categoryColor(slice.key));
    }
  });
});

describe('resolveCategoryColor', () => {
  it('returns the stored #RRGGBB hex when one is set', () => {
    expect(resolveCategoryColor('#FFCC00', 'groceries')).toBe('#FFCC00');
  });

  it('falls back to the per-key palette hash when the stored color is null', () => {
    expect(resolveCategoryColor(null, 'groceries')).toBe(categoryColor('groceries'));
  });

  it('falls back to the palette hash for an empty or malformed stored color', () => {
    expect(resolveCategoryColor('', 'groceries')).toBe(categoryColor('groceries'));
    expect(resolveCategoryColor('red', 'groceries')).toBe(categoryColor('groceries'));
  });

  it('is stable: the same key yields the same fallback color', () => {
    expect(resolveCategoryColor(null, 'groceries')).toBe(resolveCategoryColor(null, 'groceries'));
  });
});

describe('categoryColor', () => {
  it('is deterministic: the same key always maps to the same palette hue', () => {
    expect(categoryColor('groceries')).toBe(categoryColor('groceries'));
  });

  it('always returns a hue drawn from the shared chart palette', () => {
    expect(darkTheme.colors.chartSeries).toContain(categoryColor('anything'));
    expect(darkTheme.colors.chartSeries).toContain(categoryColor(''));
  });
});
