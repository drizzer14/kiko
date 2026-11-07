import {
  categoryColorsLight,
  chartSeriesDark,
  entityColorsDark,
} from '@kiko/design-system/palette';
import { darkTheme } from '@kiko/design-system/theme';
import { categoryDisplayColor } from '@kiko/design-system/entity-tint';
import { SEEDED_CATEGORIES } from '@kiko/db/__fixtures__/seeded-categories';
import { buildCategoryDisplayMap } from '@kiko/categories/category-display';
import { readSeedCategoryColors } from '@kiko/db/__fixtures__/seed-category-colors';

import {
  type BreakdownTransaction,
  buildCategoryBreakdown,
  categoryColor,
  resolveCanonicalCategoryColor,
  resolveCategoryColor,
} from './category-breakdown';

const DISPLAY = buildCategoryDisplayMap([
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'transport', title: 'Transport', icon: 'car' },
  { key: 'salary', title: 'Salary', icon: 'banknote' },
  { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
]);

const makeTransaction = (over: Partial<BreakdownTransaction>): BreakdownTransaction => ({
  id: 'tx',
  category: 'groceries',
  amountMinorUnits: -10_00,
  mcc: null,
  counterIban: null,
  description: '',
  exchangeCounterpartHoldingId: null,
  untrackedCounterpart: null,
  changeGroupId: null,
  currency: 'UAH',
  ...over,
});

describe('buildCategoryBreakdown', () => {
  it('sums the magnitude of expense (negative) transactions per category, in base minor units', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        makeTransaction({ category: 'groceries', amountMinorUnits: -30_00 }),
        makeTransaction({ category: 'groceries', amountMinorUnits: -20_00 }),
        makeTransaction({ category: 'transport', amountMinorUnits: -40_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      scheme: 'dark',
    });

    // transport (40_00) sorts before groceries (50_00)? No: groceries 50_00 > transport 40_00.
    expect(slices.map((slice) => slice.key)).toEqual(['groceries', 'transport']);
    expect(slices.map((slice) => slice.amount)).toEqual([50_00, 40_00]);
  });

  it("nets a split payment's linked change-returns into its category (not overstated by the change)", () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        makeTransaction({
          id: 'pay',
          category: 'groceries',
          amountMinorUnits: -212_00,
          changeGroupId: 'grp-1',
        }),
        makeTransaction({ id: 'r1', category: null, amountMinorUnits: 20, changeGroupId: 'grp-1' }),
        makeTransaction({ id: 'r2', category: null, amountMinorUnits: 8, changeGroupId: 'grp-1' }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      scheme: 'dark',
    });

    // −212_00 payment, +20 and +8 returns → the category shows the NET 211_72,
    // not the bare 212_00. The positive returns are skipped as income (never a
    // separate slice) and only reduce the payment's magnitude.
    expect(slices.map((slice) => slice.key)).toEqual(['groceries']);
    expect(slices[0].amount).toBe(211_72);
  });

  it('excludes income (positive) transactions entirely', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        makeTransaction({ category: 'salary', amountMinorUnits: 100_00 }),
        makeTransaction({ category: 'groceries', amountMinorUnits: -25_00 }),
        makeTransaction({ category: 'groceries', amountMinorUnits: 5_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      scheme: 'dark',
    });

    expect(slices.map((slice) => slice.key)).toEqual(['groceries']);
    expect(slices[0].amount).toBe(25_00);
  });

  it('derives shares over the visible slices that sum to ~1', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        makeTransaction({ category: 'groceries', amountMinorUnits: -75_00 }),
        makeTransaction({ category: 'transport', amountMinorUnits: -25_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      scheme: 'dark',
    });

    expect(slices[0].share).toBeCloseTo(0.75, 6);
    expect(slices[1].share).toBeCloseTo(0.25, 6);
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1, 6);
  });

  it('converts a foreign-currency expense into the base currency at the rate table', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        makeTransaction({ category: 'groceries', amountMinorUnits: -10_00, currency: 'USD' }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: { USD: 40 },
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      scheme: 'dark',
    });

    // 10 USD * 40 = 400 UAH = 400_00 minor units.
    expect(slices[0].amount).toBe(400_00);
  });

  it('silently drops an expense whose currency has no rate to the base', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        makeTransaction({ category: 'groceries', amountMinorUnits: -10_00, currency: 'EUR' }),
        makeTransaction({ category: 'transport', amountMinorUnits: -20_00, currency: 'UAH' }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      scheme: 'dark',
    });

    expect(slices.map((slice) => slice.key)).toEqual(['transport']);
  });

  it('folds null-category spending into the default category (no separate uncategorized bucket)', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        makeTransaction({ category: null, amountMinorUnits: -10_00 }),
        makeTransaction({ category: null, amountMinorUnits: -5_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      scheme: 'dark',
    });

    expect(slices).toHaveLength(1);
    expect(slices[0].key).toBe('other');
    expect(slices[0].title).toBe('Other');
    expect(slices[0].amount).toBe(15_00);
  });

  it('merges null-category spending into the SAME slice as explicit default-category spending', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        makeTransaction({ category: 'other', amountMinorUnits: -10_00 }),
        makeTransaction({ category: null, amountMinorUnits: -5_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      scheme: 'dark',
    });

    expect(slices).toHaveLength(1);
    expect(slices[0].key).toBe('other');
    expect(slices[0].amount).toBe(15_00);
  });

  it('folds a category absent from the display map into the default slice', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        makeTransaction({ id: 'a', category: 'Groceries', amountMinorUnits: -500_00 }),
        makeTransaction({ id: 'b', category: 'other', amountMinorUnits: -100_00 }),
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
      scheme: 'dark',
    });

    expect(slices).toHaveLength(1);
    expect(slices[0].key).toBe('other');
    expect(slices[0].amount).toBe(600_00);
    expect(slices[0].share).toBe(1);
  });

  it('folds null spending into the CONFIGURED default key, not a hardcoded one', () => {
    const slices = buildCategoryBreakdown({
      transactions: [makeTransaction({ category: null, amountMinorUnits: -10_00 })],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'salary',
      scheme: 'dark',
    });

    expect(slices[0].key).toBe('salary');
    expect(slices[0].title).toBe('Salary');
  });

  it('resolves each slice title and icon through the display map', () => {
    const slices = buildCategoryBreakdown({
      transactions: [makeTransaction({ category: 'transport', amountMinorUnits: -10_00 })],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      scheme: 'dark',
    });

    expect(slices[0].title).toBe('Transport');
    expect(slices[0].icon).toBe('car');
  });

  it('excludes the categories named in excludedCategories and reshares the remainder', () => {
    const input = {
      transactions: [
        makeTransaction({ category: 'groceries', amountMinorUnits: -75_00 }),
        makeTransaction({ category: 'transport', amountMinorUnits: -25_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH' as const,
      defaultCategoryKey: 'other' as const,
      scheme: 'dark' as const,
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
        makeTransaction({ id: 'transfer-debit', category: 'groceries', amountMinorUnits: -75_00 }),
        makeTransaction({ id: 'kept', category: 'transport', amountMinorUnits: -25_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      excludedTransactionIds: new Set(['transfer-debit']),
      scheme: 'dark',
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
        makeTransaction({ category: 'groceries', amountMinorUnits: -10_00 }),
        makeTransaction({ category: 'transport', amountMinorUnits: -10_00 }),
      ],
      categoryDisplay: colored,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      scheme: 'dark',
    });

    const byKey = new Map(slices.map((slice) => [slice.key, slice.color]));
    expect(byKey.get('groceries')).toBe('#123456');
    expect(byKey.get('transport')).toBe(categoryColor('transport'));
  });

  it('colors each slice from the shared chart palette, stably per category key', () => {
    const slices = buildCategoryBreakdown({
      transactions: [
        makeTransaction({ category: 'groceries', amountMinorUnits: -10_00 }),
        makeTransaction({ category: 'transport', amountMinorUnits: -10_00 }),
      ],
      categoryDisplay: DISPLAY,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      scheme: 'dark',
    });

    for (const slice of slices) {
      expect(darkTheme.colors.chartSeries).toContain(slice.color);
      expect(slice.color).toBe(categoryColor(slice.key));
    }
  });
});

describe('resolveCategoryColor', () => {
  it('returns the stored #RRGGBB hex when one is set', () => {
    expect(resolveCategoryColor('#FFCC00', 'groceries', 'dark')).toBe('#FFCC00');
  });

  it('falls back to the per-key palette hash when the stored color is null', () => {
    expect(resolveCategoryColor(null, 'groceries', 'dark')).toBe(categoryColor('groceries'));
  });

  it('falls back to the palette hash for an empty or malformed stored color', () => {
    expect(resolveCategoryColor('', 'groceries', 'dark')).toBe(categoryColor('groceries'));
    expect(resolveCategoryColor('red', 'groceries', 'dark')).toBe(categoryColor('groceries'));
  });

  it('is stable: the same key yields the same fallback color', () => {
    expect(resolveCategoryColor(null, 'groceries', 'dark')).toBe(
      resolveCategoryColor(null, 'groceries', 'dark'),
    );
  });

  it('passes a stored hex through unchanged', () => {
    expect(resolveCategoryColor('#FFFFFF', 'groceries', 'dark')).toBe('#FFFFFF');
    expect(resolveCategoryColor('#123456', 'groceries', 'dark')).toBe('#123456');
  });

  it('an uncolored category hashes to a dark hue, then maps', () => {
    expect(resolveCategoryColor(null, 'groceries', 'dark')).toBe(categoryColor('groceries'));
    expect(resolveCategoryColor(null, 'groceries', 'light')).toBe(
      categoryDisplayColor(categoryColor('groceries'), 'light'),
    );
  });

  it('maps a stored swatch hex to the category set in light, in either letter case', () => {
    expect(resolveCategoryColor(entityColorsDark.violet, 'groceries', 'light')).toBe(
      categoryColorsLight.violet,
    );
    expect(resolveCategoryColor(entityColorsDark.violet.toLowerCase(), 'groceries', 'light')).toBe(
      categoryColorsLight.violet,
    );
  });

  it('keeps a stored out-of-set hex readable in light', () => {
    expect(resolveCategoryColor('#FFFF00', 'groceries', 'light')).toBe(
      categoryDisplayColor('#FFFF00', 'light'),
    );
  });
});

describe('resolveCanonicalCategoryColor', () => {
  it('returns the stored hex as stored, with no scheme', () => {
    expect(resolveCanonicalCategoryColor(entityColorsDark.violet, 'groceries')).toBe(
      entityColorsDark.violet,
    );
  });

  it('returns the dark hash hue for a null, empty or malformed stored color', () => {
    expect(resolveCanonicalCategoryColor(null, 'groceries')).toBe(categoryColor('groceries'));
    expect(resolveCanonicalCategoryColor('', 'groceries')).toBe(categoryColor('groceries'));
    expect(resolveCanonicalCategoryColor('red', 'groceries')).toBe(categoryColor('groceries'));
  });
});

describe('buildCategoryBreakdown scheme', () => {
  const coloredDisplay = buildCategoryDisplayMap([
    { key: 'groceries', title: 'Groceries', icon: 'cart', color: entityColorsDark.blue },
    { key: 'transport', title: 'Transport', icon: 'car' },
    { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
  ]);
  const breakdownIn = (scheme: 'dark' | 'light') =>
    buildCategoryBreakdown({
      transactions: [
        makeTransaction({ category: 'groceries', amountMinorUnits: -30_00 }),
        makeTransaction({ category: 'transport', amountMinorUnits: -20_00 }),
      ],
      categoryDisplay: coloredDisplay,
      rateTable: {},
      baseCurrency: 'UAH',
      defaultCategoryKey: 'other',
      scheme,
    });

  it('paints each light slice through the category map, stored or hashed', () => {
    const byKey = new Map(breakdownIn('light').map((slice) => [slice.key, slice.color]));

    expect(byKey.get('groceries')).toBe(categoryColorsLight.blue);
    expect(byKey.get('transport')).toBe(categoryDisplayColor(categoryColor('transport'), 'light'));
  });

  it('keeps the dark slices on the stored and hashed dark hexes', () => {
    const byKey = new Map(breakdownIn('dark').map((slice) => [slice.key, slice.color]));

    expect(byKey.get('groceries')).toBe(entityColorsDark.blue);
    expect(byKey.get('transport')).toBe(categoryColor('transport'));
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

// The ten categories `0002_seed_categories.sql` seeds hash onto the
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
describe('seeded category colors', () => {
  const seeded: Record<string, string> = Object.fromEntries(
    readSeedCategoryColors().map(({ key, color }) => [key, color]),
  );

  it('resolves the eight colored seeded categories to eight distinct colors', () => {
    const resolved = Object.entries(seeded).map(([key, color]) =>
      resolveCategoryColor(color, key, 'dark'),
    );

    expect(new Set(resolved).size).toBe(8);
    expect(resolved).toEqual(Object.values(seeded));
  });

  it('leaves utilities and entertainment uncolored, falling back to the categoryColor hash', () => {
    for (const key of ['utilities', 'entertainment']) {
      expect(seeded[key]).toBeUndefined();
      expect(resolveCategoryColor(seeded[key], key, 'dark')).toBe(categoryColor(key));
    }
  });

  it('still collapses the ten keys onto fewer than ten hues WITHOUT stored colors, which is why the seed exists', () => {
    const keys = SEEDED_CATEGORIES.map((category) => category.key);

    expect(new Set(keys.map((key) => categoryColor(key))).size).toBeLessThan(10);
  });
});
