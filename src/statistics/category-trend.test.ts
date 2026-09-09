import { buildCategoryDisplayMap } from '../categories/category-display';

import { type BreakdownTransaction, categoryColor } from './category-breakdown';
import { buildCategoryTrend, type TrendTransaction } from './category-trend';

const DISPLAY = buildCategoryDisplayMap([
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'transport', title: 'Transport', icon: 'car' },
  { key: 'salary', title: 'Salary', icon: 'banknote' },
  { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
]);

// A fixed "today" reference, so every window is deterministic. The builder
// buckets by UTC day and spans the last 30 days ending on this instant.
const NOW = Date.UTC(2025, 2, 31, 12, 0, 0); // 2025-03-31, midday UTC
const dayMs = 86_400_000;
const dayBucketOf = (t: number): number => {
  const d = new Date(t);

  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const tx = (over: Partial<TrendTransaction>): TrendTransaction => ({
  id: 'tx',
  category: 'groceries',
  amountMinorUnits: -10_00,
  mcc: null,
  counterIban: null,
  description: '',
  exchangeCounterpartHoldingId: null,
  currency: 'UAH' as BreakdownTransaction['currency'],
  time: NOW,
  ...over,
});

const buildTrend = (
  transactions: TrendTransaction[],
  extra: Partial<Parameters<typeof buildCategoryTrend>[0]> = {},
): ReturnType<typeof buildCategoryTrend> =>
  buildCategoryTrend({
    transactions,
    categoryDisplay: DISPLAY,
    rateTable: {},
    baseCurrency: 'UAH',
    defaultCategoryKey: 'other',
    now: NOW,
    ...extra,
  });

describe('buildCategoryTrend', () => {
  it('emits exactly 30 daily buckets ending on now, ascending', () => {
    const series = buildTrend([tx({ time: NOW, amountMinorUnits: -10_00 })]);
    const points = series[0].points;

    expect(points).toHaveLength(30);
    expect(points[29].t).toBe(dayBucketOf(NOW));
    expect(points[0].t).toBe(dayBucketOf(NOW) - 29 * dayMs);
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i].t - points[i - 1].t).toBe(dayMs);
    }
  });

  it('buckets a same-day expense into that UTC day and no other, summing in major units', () => {
    const series = buildTrend([
      tx({ id: 'a', category: 'groceries', amountMinorUnits: -25_00, time: NOW }),
      tx({ id: 'b', category: 'groceries', amountMinorUnits: -5_00, time: NOW }),
    ]);
    const nonZero = series[0].points.filter((point) => point.amount !== 0);

    expect(series[0].key).toBe('groceries');
    expect(nonZero).toEqual([{ t: dayBucketOf(NOW), amount: 30 }]);
  });

  it('resolves each series title and color from the category display', () => {
    const series = buildTrend([tx({ id: 'a', category: 'groceries', amountMinorUnits: -30_00 })]);

    expect(series[0].title).toBe('Groceries');
    expect(series[0].color).toBe(categoryColor('groceries'));
  });

  it('ignores income (non-negative amounts) entirely', () => {
    const series = buildTrend([
      tx({ id: 'a', category: 'groceries', amountMinorUnits: -25_00, time: NOW }),
      tx({ id: 'b', category: 'salary', amountMinorUnits: 100_00, time: NOW }),
      tx({ id: 'c', category: 'groceries', amountMinorUnits: 0, time: NOW }),
    ]);

    expect(series.map((entry) => entry.key)).toEqual(['groceries']);
  });

  it('drops rows listed in excludedTransactionIds by id', () => {
    const series = buildTrend(
      [
        tx({ id: 'keep', category: 'groceries', amountMinorUnits: -30_00, time: NOW }),
        tx({ id: 'drop', category: 'groceries', amountMinorUnits: -70_00, time: NOW }),
      ],
      { excludedTransactionIds: new Set(['drop']) },
    );
    const nonZero = series[0].points.filter((point) => point.amount !== 0);

    expect(nonZero).toEqual([{ t: dayBucketOf(NOW), amount: 30 }]);
  });

  it('drops a transaction whose currency has no rate to the base', () => {
    const series = buildTrend([
      tx({ id: 'a', category: 'groceries', amountMinorUnits: -30_00, currency: 'UAH', time: NOW }),
      tx({ id: 'b', category: 'transport', amountMinorUnits: -40_00, currency: 'USD', time: NOW }),
    ]);

    // The base is UAH; the USD row has no USD->UAH rate in the empty table.
    expect(series.map((entry) => entry.key)).toEqual(['groceries']);
  });

  it('folds a null/empty category into the default category key', () => {
    const series = buildTrend([
      tx({ id: 'a', category: null, amountMinorUnits: -30_00, time: NOW }),
      tx({ id: 'b', category: '', amountMinorUnits: -20_00, time: NOW }),
    ]);
    const nonZero = series[0].points.filter((point) => point.amount !== 0);

    expect(series).toHaveLength(1);
    expect(series[0].key).toBe('other');
    expect(nonZero).toEqual([{ t: dayBucketOf(NOW), amount: 50 }]);
  });

  it('drops categories listed in excludedCategories', () => {
    const series = buildTrend(
      [
        tx({ id: 'a', category: 'groceries', amountMinorUnits: -30_00, time: NOW }),
        tx({ id: 'b', category: 'transport', amountMinorUnits: -40_00, time: NOW }),
      ],
      { excludedCategories: new Set(['transport']) },
    );

    expect(series.map((entry) => entry.key)).toEqual(['groceries']);
  });

  it('zero-fills gap days so every series shares one ordered set of 30 X positions', () => {
    const day0 = dayBucketOf(NOW);
    const series = buildTrend([
      tx({ id: 'a', category: 'groceries', amountMinorUnits: -30_00, time: NOW }),
      tx({ id: 'b', category: 'groceries', amountMinorUnits: -10_00, time: NOW - 2 * dayMs }),
      tx({ id: 'c', category: 'transport', amountMinorUnits: -20_00, time: NOW - dayMs }),
    ]);

    const groceries = series.find((entry) => entry.key === 'groceries');
    const transport = series.find((entry) => entry.key === 'transport');

    // Both series span the identical 30-day window at identical X positions.
    expect(groceries?.points).toHaveLength(30);
    expect(transport?.points.map((point) => point.t)).toEqual(
      groceries?.points.map((point) => point.t),
    );
    // The last three days carry the spend; every gap day reads 0, not a hole.
    const grLast3 = groceries?.points.slice(27).map((point) => point.amount);
    const trLast3 = transport?.points.slice(27).map((point) => point.amount);
    expect(grLast3).toEqual([10, 0, 30]);
    expect(trLast3).toEqual([0, 20, 0]);
    // A day with no spend on either series is present and zero.
    expect(groceries?.points[0]).toEqual({ t: day0 - 29 * dayMs, amount: 0 });
  });

  it('drops expenses older than the 30-day window (no bucket, no total)', () => {
    const old = tx({
      id: 'old',
      time: NOW - 40 * dayMs,
      amountMinorUnits: -99_00,
      category: 'transport',
    });
    const recent = tx({
      id: 'recent',
      time: NOW - 2 * dayMs,
      amountMinorUnits: -10_00,
      category: 'groceries',
    });
    const series = buildTrend([old, recent]);

    // transport is fully excluded — it never appears in the series at all.
    expect(series.map((entry) => entry.key)).toEqual(['groceries']);
  });

  it('drops an expense dated in the future (after now)', () => {
    const series = buildTrend([
      tx({ id: 'future', time: NOW + dayMs, amountMinorUnits: -50_00, category: 'transport' }),
      tx({ id: 'in-window', time: NOW, amountMinorUnits: -10_00, category: 'groceries' }),
    ]);

    expect(series.map((entry) => entry.key)).toEqual(['groceries']);
  });

  it('keeps the window fixed even when the only expense is far in the past', () => {
    const series = buildTrend([tx({ time: NOW - 100 * dayMs, amountMinorUnits: -5_00 })]);

    // The only expense is outside the window, so no series survives.
    expect(series).toEqual([]);
  });

  it('sorts the series by total spend descending', () => {
    const series = buildTrend([
      tx({ id: 'a', category: 'groceries', amountMinorUnits: -30_00, time: NOW }),
      tx({ id: 'b', category: 'transport', amountMinorUnits: -80_00, time: NOW }),
    ]);

    expect(series.map((entry) => entry.key)).toEqual(['transport', 'groceries']);
  });

  it('returns an empty array for empty input', () => {
    expect(buildTrend([])).toEqual([]);
  });
});
