import { buildCategoryDisplayMap } from '@kiko/categories/category-display';

import { type BreakdownTransaction, categoryColor } from '../category-breakdown';

import { buildCategoryMeasures, buildCategoryTrend, type TrendTransaction } from './category-trend';

const DISPLAY = buildCategoryDisplayMap([
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'transport', title: 'Transport', icon: 'car' },
  { key: 'salary', title: 'Salary', icon: 'banknote' },
  { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
]);

// A fixed "today" reference, so every range is deterministic.
const NOW = Date.UTC(2025, 2, 31, 12, 0, 0); // 2025-03-31, midday UTC
const dayMs = 86_400_000;

// The default test range: 3 days back from NOW to NOW, daily buckets — 4
// bucket instants (NOW-3d, NOW-2d, NOW-1d, NOW), all evenly spaced since the
// span is an exact multiple of a day.
const DEFAULT_RANGE = { from: NOW - 3 * dayMs, to: NOW };
const DEFAULT_BUCKET_DAYS = 1;

const transaction = (over: Partial<TrendTransaction>): TrendTransaction => ({
  id: 'tx',
  category: 'groceries',
  amountMinorUnits: -10_00,
  mcc: null,
  counterIban: null,
  description: '',
  exchangeCounterpartHoldingId: null,
  changeGroupId: null,
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
    range: DEFAULT_RANGE,
    bucketDays: DEFAULT_BUCKET_DAYS,
    ...extra,
  });

describe('buildCategoryTrend', () => {
  it('emits one bucket per day across the given range, ascending, closing on `to`', () => {
    const series = buildTrend([transaction({ time: NOW, amountMinorUnits: -10_00 })]);
    const points = series[0].points;

    expect(points).toHaveLength(4);
    expect(points[0].t).toBe(DEFAULT_RANGE.from);
    expect(points[3].t).toBe(DEFAULT_RANGE.to);

    for (let i = 1; i < points.length; i += 1) {
      expect(points[i].t - points[i - 1].t).toBe(dayMs);
    }
  });

  it('buckets a same-day expense into that bucket and no other, summing in major units', () => {
    const series = buildTrend([
      transaction({ id: 'a', category: 'groceries', amountMinorUnits: -25_00, time: NOW }),
      transaction({ id: 'b', category: 'groceries', amountMinorUnits: -5_00, time: NOW }),
    ]);
    const nonZero = series[0].points.filter((point) => point.amount !== 0);

    expect(series[0].key).toBe('groceries');
    expect(nonZero).toEqual([{ t: NOW, amount: 30 }]);
  });

  it('buckets a mid-day (non-boundary) expense into the bucket period that CONTAINS it, not the next one', () => {
    // Halfway through the period [NOW-2d, NOW-1d) — must land in the NOW-2d
    // bucket, not be pushed forward into NOW-1d.
    const midDay = NOW - 2 * dayMs + 12 * 60 * 60 * 1000;
    const series = buildTrend([transaction({ id: 'a', time: midDay, amountMinorUnits: -15_00 })]);
    const nonZero = series[0].points.filter((point) => point.amount !== 0);

    expect(nonZero).toEqual([{ t: NOW - 2 * dayMs, amount: 15 }]);
  });

  it("nets a split payment's linked change-returns into its trend line (not overstated by the change)", () => {
    const series = buildTrend([
      transaction({
        id: 'pay',
        category: 'groceries',
        amountMinorUnits: -212_00,
        time: NOW,
        changeGroupId: 'grp-1',
      }),
      transaction({
        id: 'r1',
        category: null,
        amountMinorUnits: 20,
        time: NOW,
        changeGroupId: 'grp-1',
      }),
      transaction({
        id: 'r2',
        category: null,
        amountMinorUnits: 8,
        time: NOW,
        changeGroupId: 'grp-1',
      }),
    ]);
    const nonZero = series[0].points.filter((point) => point.amount !== 0);

    // −212_00 payment, +20 and +8 returns → the bucket shows the NET 211_72
    // (211.72 in base MAJOR units), not the bare 212_00. The positive returns are
    // already skipped as income and only reduce the payment's magnitude.
    expect(series.map((entry) => entry.key)).toEqual(['groceries']);
    expect(nonZero).toEqual([{ t: NOW, amount: 211.72 }]);
  });

  it('resolves each series title and color from the category display', () => {
    const series = buildTrend([
      transaction({ id: 'a', category: 'groceries', amountMinorUnits: -30_00 }),
    ]);

    expect(series[0].title).toBe('Groceries');
    expect(series[0].color).toBe(categoryColor('groceries'));
  });

  it('ignores income (non-negative amounts) entirely', () => {
    const series = buildTrend([
      transaction({ id: 'a', category: 'groceries', amountMinorUnits: -25_00, time: NOW }),
      transaction({ id: 'b', category: 'salary', amountMinorUnits: 100_00, time: NOW }),
      transaction({ id: 'c', category: 'groceries', amountMinorUnits: 0, time: NOW }),
    ]);

    expect(series.map((entry) => entry.key)).toEqual(['groceries']);
  });

  it('drops rows listed in excludedTransactionIds by id', () => {
    const series = buildTrend(
      [
        transaction({ id: 'keep', category: 'groceries', amountMinorUnits: -30_00, time: NOW }),
        transaction({ id: 'drop', category: 'groceries', amountMinorUnits: -70_00, time: NOW }),
      ],
      { excludedTransactionIds: new Set(['drop']) },
    );
    const nonZero = series[0].points.filter((point) => point.amount !== 0);

    expect(nonZero).toEqual([{ t: NOW, amount: 30 }]);
  });

  it('drops a transaction whose currency has no rate to the base', () => {
    const series = buildTrend([
      transaction({
        id: 'a',
        category: 'groceries',
        amountMinorUnits: -30_00,
        currency: 'UAH',
        time: NOW,
      }),
      transaction({
        id: 'b',
        category: 'transport',
        amountMinorUnits: -40_00,
        currency: 'USD',
        time: NOW,
      }),
    ]);

    // The base is UAH; the USD row has no USD->UAH rate in the empty table.
    expect(series.map((entry) => entry.key)).toEqual(['groceries']);
  });

  it('folds a null/empty category into the default category key', () => {
    const series = buildTrend([
      transaction({ id: 'a', category: null, amountMinorUnits: -30_00, time: NOW }),
      transaction({ id: 'b', category: '', amountMinorUnits: -20_00, time: NOW }),
    ]);
    const nonZero = series[0].points.filter((point) => point.amount !== 0);

    expect(series).toHaveLength(1);
    expect(series[0].key).toBe('other');
    expect(nonZero).toEqual([{ t: NOW, amount: 50 }]);
  });

  it('drops categories listed in excludedCategories', () => {
    const series = buildTrend(
      [
        transaction({ id: 'a', category: 'groceries', amountMinorUnits: -30_00, time: NOW }),
        transaction({ id: 'b', category: 'transport', amountMinorUnits: -40_00, time: NOW }),
      ],
      { excludedCategories: new Set(['transport']) },
    );

    expect(series.map((entry) => entry.key)).toEqual(['groceries']);
  });

  it('zero-fills gap buckets so every series shares one ordered set of bucket X positions', () => {
    const series = buildTrend([
      transaction({ id: 'a', category: 'groceries', amountMinorUnits: -30_00, time: NOW }),
      transaction({
        id: 'b',
        category: 'groceries',
        amountMinorUnits: -10_00,
        time: NOW - 2 * dayMs,
      }),
      transaction({ id: 'c', category: 'transport', amountMinorUnits: -20_00, time: NOW - dayMs }),
    ]);

    const groceries = series.find((entry) => entry.key === 'groceries');
    const transport = series.find((entry) => entry.key === 'transport');

    // Both series span the identical bucket set at identical X positions.
    expect(groceries?.points).toHaveLength(4);
    expect(transport?.points.map((point) => point.t)).toEqual(
      groceries?.points.map((point) => point.t),
    );
    expect(groceries?.points.map((point) => point.amount)).toEqual([0, 10, 0, 30]);
    expect(transport?.points.map((point) => point.amount)).toEqual([0, 0, 20, 0]);
  });

  it('drops expenses whose time falls outside [range.from, range.to]', () => {
    const old = transaction({
      id: 'old',
      time: DEFAULT_RANGE.from - 40 * dayMs,
      amountMinorUnits: -99_00,
      category: 'transport',
    });
    const recent = transaction({
      id: 'recent',
      time: NOW - 2 * dayMs,
      amountMinorUnits: -10_00,
      category: 'groceries',
    });
    const series = buildTrend([old, recent]);

    // transport is fully excluded — it never appears in the series at all.
    expect(series.map((entry) => entry.key)).toEqual(['groceries']);
  });

  it('drops an expense dated after `range.to`', () => {
    const series = buildTrend([
      transaction({
        id: 'future',
        time: DEFAULT_RANGE.to + dayMs,
        amountMinorUnits: -50_00,
        category: 'transport',
      }),
      transaction({ id: 'in-window', time: NOW, amountMinorUnits: -10_00, category: 'groceries' }),
    ]);

    expect(series.map((entry) => entry.key)).toEqual(['groceries']);
  });

  it('keeps the range fixed even when the only expense is before `range.from`', () => {
    const series = buildTrend([
      transaction({ time: DEFAULT_RANGE.from - 100 * dayMs, amountMinorUnits: -5_00 }),
    ]);

    // The only expense is outside the range, so no series survives.
    expect(series).toEqual([]);
  });

  it('sorts the series by total spend descending', () => {
    const series = buildTrend([
      transaction({ id: 'a', category: 'groceries', amountMinorUnits: -30_00, time: NOW }),
      transaction({ id: 'b', category: 'transport', amountMinorUnits: -80_00, time: NOW }),
    ]);

    expect(series.map((entry) => entry.key)).toEqual(['transport', 'groceries']);
  });

  it('returns an empty array for empty input', () => {
    expect(buildTrend([])).toEqual([]);
  });

  it('buckets weekly once the range crosses the coarsening threshold, sharing 7-day-spaced X positions', () => {
    const range = { from: NOW - 14 * dayMs, to: NOW };
    const series = buildTrend(
      [
        transaction({ id: 'a', category: 'groceries', amountMinorUnits: -30_00, time: NOW }),
        transaction({
          id: 'b',
          category: 'groceries',
          amountMinorUnits: -10_00,
          time: NOW - 10 * dayMs,
        }),
      ],
      { range, bucketDays: 7 },
    );
    const points = series[0].points;

    expect(points).toHaveLength(3);
    expect(points.map((point) => point.t)).toEqual([range.from, range.from + 7 * dayMs, range.to]);
    // NOW - 10d (range.from + 4d) is a MID-PERIOD instant inside the first
    // weekly period [range.from, range.from + 7d) — it stays in the range.from
    // bucket rather than being shifted into the next one; the same-day expense
    // lands in the final bucket (range.to).
    expect(points.map((point) => point.amount)).toEqual([10, 0, 30]);
  });
});

const buildMeasures = (
  transactions: TrendTransaction[],
  extra: Partial<Parameters<typeof buildCategoryMeasures>[0]> = {},
): ReturnType<typeof buildCategoryMeasures> =>
  buildCategoryMeasures({
    transactions,
    rateTable: {},
    baseCurrency: 'UAH',
    defaultCategoryKey: 'other',
    range: DEFAULT_RANGE,
    bucketDays: DEFAULT_BUCKET_DAYS,
    ...extra,
  });

describe('buildCategoryMeasures', () => {
  it('reports the total spend (base minor units) per category over the range', () => {
    const measures = buildMeasures([
      transaction({ id: 'a', category: 'groceries', amountMinorUnits: -25_00, time: NOW }),
      transaction({ id: 'b', category: 'groceries', amountMinorUnits: -5_00, time: NOW }),
    ]);

    expect(measures).toHaveLength(1);
    expect(measures[0]).toMatchObject({ key: 'groceries', total: 30_00 });
  });

  it('counts the kept transactions per category', () => {
    const measures = buildMeasures([
      transaction({ id: 'a', category: 'groceries', amountMinorUnits: -10_00, time: NOW }),
      transaction({ id: 'b', category: 'groceries', amountMinorUnits: -10_00, time: NOW - dayMs }),
      transaction({ id: 'c', category: 'transport', amountMinorUnits: -10_00, time: NOW }),
    ]);
    const groceries = measures.find((measure) => measure.key === 'groceries');
    const transport = measures.find((measure) => measure.key === 'transport');

    expect(groceries?.count).toBe(2);
    expect(transport?.count).toBe(1);
  });

  it('excludes income, out-of-range, and excluded-id rows from the count and total', () => {
    const measures = buildMeasures(
      [
        transaction({ id: 'keep', category: 'groceries', amountMinorUnits: -10_00, time: NOW }),
        transaction({ id: 'income', category: 'groceries', amountMinorUnits: 50_00, time: NOW }),
        transaction({
          id: 'old',
          category: 'groceries',
          amountMinorUnits: -10_00,
          time: DEFAULT_RANGE.from - 40 * dayMs,
        }),
        transaction({ id: 'drop', category: 'groceries', amountMinorUnits: -10_00, time: NOW }),
      ],
      { excludedTransactionIds: new Set(['drop']) },
    );

    expect(measures[0]).toMatchObject({ key: 'groceries', count: 1, total: 10_00 });
  });

  it('reports a positive rising slope for spend that climbs across the range', () => {
    // Spend on the last three buckets: rising 10, 20, 30 (major units).
    const measures = buildMeasures([
      transaction({
        id: 'a',
        category: 'groceries',
        amountMinorUnits: -10_00,
        time: NOW - 2 * dayMs,
      }),
      transaction({ id: 'b', category: 'groceries', amountMinorUnits: -20_00, time: NOW - dayMs }),
      transaction({ id: 'c', category: 'groceries', amountMinorUnits: -30_00, time: NOW }),
    ]);

    expect(measures[0].risingSlope).toBeGreaterThan(0);
  });

  it('reports a negative rising slope for spend concentrated at the range start', () => {
    // Spend sits at the earliest range buckets (low x) and stops, so the
    // per-bucket regression trends downward across the range.
    const measures = buildMeasures([
      transaction({
        id: 'a',
        category: 'groceries',
        amountMinorUnits: -30_00,
        time: DEFAULT_RANGE.from,
      }),
      transaction({
        id: 'b',
        category: 'groceries',
        amountMinorUnits: -20_00,
        time: NOW - 2 * dayMs,
      }),
      transaction({ id: 'c', category: 'groceries', amountMinorUnits: -10_00, time: NOW - dayMs }),
    ]);

    expect(measures[0].risingSlope).toBeLessThan(0);
  });

  it('returns an empty array for empty input', () => {
    expect(buildMeasures([])).toEqual([]);
  });
});
