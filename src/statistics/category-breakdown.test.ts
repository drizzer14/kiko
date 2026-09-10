import { SEEDED_CATEGORIES } from '@kiko/db/__fixtures__/seeded-categories';

import { buildCategoryDisplayMap } from '../categories/category-display';
import { readSeedCategoryColors } from '../db/__fixtures__/seed-category-colors';
import { chartSeriesDark } from '../design-system/palette';
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
  { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
]);

const tx = (over: Partial<BreakdownTransaction>): BreakdownTransaction => ({
  id: 'tx',
  category: 'groceries',
  amountMinorUnits: -10_00,
  mcc: null,
  counterIban: null,
  description: '',
  exchangeCounterpartHoldingId: null,
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
      defaultCategoryKey: 'other',
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
      defaultCategoryKey: 'other',
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
      defaultCategoryKey: 'other',
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
      defaultCategoryKey: 'other',
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
      defaultCategoryKey: 'other',
    });

    expect(slices.map((slice) => slice.key)).toEqual(['transport']);
  });

  it('folds null-category spending into the default category (no separate uncategorized bucket)', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        tx({ category: null, amountMinorUnits: -10_00 }),
        tx({ category: null, amountMinorUnits: -5_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
    });

    expect(slices).toHaveLength(1);
    expect(slices[0].key).toBe('other');
    expect(slices[0].title).toBe('Other');
    expect(slices[0].amount).toBe(15_00);
  });

  it('merges null-category spending into the SAME slice as explicit default-category spending', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        tx({ category: 'other', amountMinorUnits: -10_00 }),
        tx({ category: null, amountMinorUnits: -5_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
    });

    expect(slices).toHaveLength(1);
    expect(slices[0].key).toBe('other');
    expect(slices[0].amount).toBe(15_00);
  });

  it('folds a category absent from the display map into the default slice', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        tx({ id: 'a', category: 'Groceries', amountMinorUnits: -500_00 }),
        tx({ id: 'b', category: 'other', amountMinorUnits: -100_00 }),
      ],
      // 'Groceries' lowercases to 'groceries', which is NOT in this map — the
      // same fold `resolveCategoryKey` applies for Home's filter chips, so an
      // unresolvable slug merges into the default instead of becoming its own
      // wedge carrying the default's title in a different palette hue.
      categoryDisplay: buildCategoryDisplayMap([
        { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
      ]),
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
    });

    expect(slices).toHaveLength(1);
    expect(slices[0].key).toBe('other');
    expect(slices[0].amount).toBe(600_00);
    expect(slices[0].share).toBe(1);
  });

  it('folds null spending into the CONFIGURED default key, not a hardcoded one', () => {
    const slices = buildCategoryBreakdown({
      transactions: [tx({ category: null, amountMinorUnits: -10_00 })],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'salary',
    });

    expect(slices[0].key).toBe('salary');
    expect(slices[0].title).toBe('Salary');
  });

  it('resolves each slice title and icon through the display map', () => {
    const slices = buildCategoryBreakdown({
      transactions: [tx({ category: 'transport', amountMinorUnits: -10_00 })],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
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
      defaultCategoryKey: 'other' as const,
    };

    const slices = buildCategoryBreakdown({
      ...input,
      excludedCategories: new Set(['transport']),
    });

    expect(slices.map((slice) => slice.key)).toEqual(['groceries']);
    // The lone remaining slice reshares to the whole of the visible total.
    expect(slices[0].share).toBeCloseTo(1, 6);
  });

  it('drops the transactions whose id is in excludedTransactionIds and reshares the remainder', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        tx({ id: 'transfer-debit', category: 'groceries', amountMinorUnits: -75_00 }),
        tx({ id: 'kept', category: 'transport', amountMinorUnits: -25_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      excludedTransactionIds: new Set(['transfer-debit']),
    });

    expect(slices.map((slice) => slice.key)).toEqual(['transport']);
    // The remaining slice reshares to the whole of the visible total.
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
      defaultCategoryKey: 'other',
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
      defaultCategoryKey: 'other',
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

  it('passes a stored hex through unchanged', () => {
    expect(resolveCategoryColor('#FFFFFF', 'groceries')).toBe('#FFFFFF');
    expect(resolveCategoryColor('#123456', 'groceries')).toBe('#123456');
  });
});

describe('categoryColor', () => {
  it('is deterministic: the same key always maps to the same palette hue', () => {
    expect(categoryColor('groceries')).toBe(categoryColor('groceries'));
  });

  it('always returns a hue drawn from the shared chart palette', () => {
    expect(chartSeriesDark).toContain(categoryColor('anything'));
    expect(chartSeriesDark).toContain(categoryColor(''));
  });
});

// T-21: the ten categories `0002_seed_categories.sql` seeds hash onto the
// 8-entry `chartSeries` palette with FOUR collisions (verified: shopping,
// entertainment, transfers, other all land on #0A84FF). Migration
// `0017_default_category_colors.sql` gives eight of the ten seeded keys an
// explicit, distinct `categories.color`, which `resolveCategoryColor` prefers
// over the hash — this is the contract test between that migration and the
// chart layer. `utilities` and `entertainment` are intentionally left
// uncolored by the migration (see its own header comment), so they keep
// resolving through the `categoryColor` hash fallback, exactly as they did
// before the migration existed.
//
// `seeded` is parsed from the REAL migration file (via
// `readSeedCategoryColors`, `db/__fixtures__/seed-category-colors.ts`) rather
// than hand-typed here, so this file's assertions and the migration's own
// registration tests (`db/schema.category-overrides.test.ts`) read the same
// source and cannot drift apart. That file owns asserting the parsed key set
// against `SEEDED_CATEGORIES` and every color against
// `theme.colors.entityColors`; this file owns the chart-layer contract —
// `resolveCategoryColor` given those real pairs.
describe('seeded category colors (T-21)', () => {
  const seeded: Record<string, string> = Object.fromEntries(
    readSeedCategoryColors().map(({ key, color }) => [key, color]),
  );

  it('resolves the eight colored seeded categories to eight distinct colors', () => {
    const resolved = Object.entries(seeded).map(([key, color]) => resolveCategoryColor(color, key));

    expect(new Set(resolved).size).toBe(8);
    expect(resolved).toEqual(Object.values(seeded));
  });

  it('leaves utilities and entertainment uncolored, falling back to the categoryColor hash', () => {
    for (const key of ['utilities', 'entertainment']) {
      expect(seeded[key]).toBeUndefined();
      expect(resolveCategoryColor(seeded[key], key)).toBe(categoryColor(key));
    }
  });

  it('still collapses the ten keys onto fewer than ten hues WITHOUT stored colors, which is why the seed exists', () => {
    const keys = SEEDED_CATEGORIES.map((category) => category.key);

    expect(new Set(keys.map((key) => categoryColor(key))).size).toBeLessThan(10);
  });
});
