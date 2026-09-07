import { buildCategoryDisplayMap } from '../categories/category-display';

import { type BreakdownTransaction, categoryColor } from './category-breakdown';
import { buildCategoryTrend, type TrendTransaction } from './category-trend';

const DISPLAY = buildCategoryDisplayMap([
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'transport', title: 'Transport', icon: 'car' },
  { key: 'salary', title: 'Salary', icon: 'banknote' },
  { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
]);

// Three distinct calendar-month instants and the UTC-midnight-first-of-month
// buckets they fold into.
const JAN = Date.UTC(2025, 0, 15);
const FEB = Date.UTC(2025, 1, 10);
const MAR = Date.UTC(2025, 2, 5);
const JAN_BUCKET = Date.UTC(2025, 0, 1);
const FEB_BUCKET = Date.UTC(2025, 1, 1);
const MAR_BUCKET = Date.UTC(2025, 2, 1);

const tx = (over: Partial<TrendTransaction>): TrendTransaction => ({
  id: 'tx',
  category: 'groceries',
  amountMinorUnits: -10_00,
  mcc: null,
  counterIban: null,
  description: '',
  currency: 'UAH' as BreakdownTransaction['currency'],
  time: JAN,
  ...over,
});

const build = (
  transactions: TrendTransaction[],
  extra: Partial<Parameters<typeof buildCategoryTrend>[0]> = {},
): ReturnType<typeof buildCategoryTrend> =>
  buildCategoryTrend({
    transactions,
    categoryDisplay: DISPLAY,
    rateTable: {},
    baseCurrency: 'UAH',
    defaultCategoryKey: 'other',
    ...extra,
  });

describe('buildCategoryTrend', () => {
  it('buckets each category by calendar month, summing that month’s expense magnitude in major units', () => {
    const series = build([
      tx({ id: 'a', category: 'groceries', amountMinorUnits: -30_00, time: JAN }),
      tx({ id: 'b', category: 'groceries', amountMinorUnits: -20_00, time: JAN }),
      tx({ id: 'c', category: 'groceries', amountMinorUnits: -40_00, time: FEB }),
    ]);

    expect(series).toHaveLength(1);
    expect(series[0].key).toBe('groceries');
    expect(series[0].points).toEqual([
      { t: JAN_BUCKET, amount: 50 },
      { t: FEB_BUCKET, amount: 40 },
    ]);
  });

  it('resolves each series title and color from the category display', () => {
    const series = build([tx({ id: 'a', category: 'groceries', amountMinorUnits: -30_00 })]);

    expect(series[0].title).toBe('Groceries');
    expect(series[0].color).toBe(categoryColor('groceries'));
  });

  it('ignores income (non-negative amounts) entirely', () => {
    const series = build([
      tx({ id: 'a', category: 'groceries', amountMinorUnits: -25_00, time: JAN }),
      tx({ id: 'b', category: 'salary', amountMinorUnits: 100_00, time: JAN }),
      tx({ id: 'c', category: 'groceries', amountMinorUnits: 0, time: JAN }),
    ]);

    expect(series.map((entry) => entry.key)).toEqual(['groceries']);
  });

  it('drops rows listed in excludedTransactionIds by id', () => {
    const series = build(
      [
        tx({ id: 'keep', category: 'groceries', amountMinorUnits: -30_00, time: JAN }),
        tx({ id: 'drop', category: 'groceries', amountMinorUnits: -70_00, time: JAN }),
      ],
      { excludedTransactionIds: new Set(['drop']) },
    );

    expect(series[0].points).toEqual([{ t: JAN_BUCKET, amount: 30 }]);
  });

  it('drops a transaction whose currency has no rate to the base', () => {
    const series = build([
      tx({ id: 'a', category: 'groceries', amountMinorUnits: -30_00, currency: 'UAH', time: JAN }),
      tx({ id: 'b', category: 'transport', amountMinorUnits: -40_00, currency: 'USD', time: JAN }),
    ]);

    // The base is UAH; the USD row has no USD->UAH rate in the empty table.
    expect(series.map((entry) => entry.key)).toEqual(['groceries']);
  });

  it('folds a null/empty category into the default category key', () => {
    const series = build([
      tx({ id: 'a', category: null, amountMinorUnits: -30_00, time: JAN }),
      tx({ id: 'b', category: '', amountMinorUnits: -20_00, time: JAN }),
    ]);

    expect(series).toHaveLength(1);
    expect(series[0].key).toBe('other');
    expect(series[0].points).toEqual([{ t: JAN_BUCKET, amount: 50 }]);
  });

  it('drops categories listed in excludedCategories', () => {
    const series = build(
      [
        tx({ id: 'a', category: 'groceries', amountMinorUnits: -30_00, time: JAN }),
        tx({ id: 'b', category: 'transport', amountMinorUnits: -40_00, time: JAN }),
      ],
      { excludedCategories: new Set(['transport']) },
    );

    expect(series.map((entry) => entry.key)).toEqual(['groceries']);
  });

  it('zero-fills gap months so every series shares one ordered set of X positions', () => {
    const series = build([
      tx({ id: 'a', category: 'groceries', amountMinorUnits: -30_00, time: JAN }),
      tx({ id: 'b', category: 'groceries', amountMinorUnits: -10_00, time: MAR }),
      tx({ id: 'c', category: 'transport', amountMinorUnits: -20_00, time: FEB }),
    ]);

    const groceries = series.find((entry) => entry.key === 'groceries');
    const transport = series.find((entry) => entry.key === 'transport');

    // Both series span the full Jan..Mar bucket set at identical X positions.
    expect(groceries?.points.map((point) => point.t)).toEqual([JAN_BUCKET, FEB_BUCKET, MAR_BUCKET]);
    expect(transport?.points.map((point) => point.t)).toEqual([JAN_BUCKET, FEB_BUCKET, MAR_BUCKET]);
    // The gap months read 0, not a missing point.
    expect(groceries?.points.map((point) => point.amount)).toEqual([30, 0, 10]);
    expect(transport?.points.map((point) => point.amount)).toEqual([0, 20, 0]);
  });

  it('sorts the series by total spend descending', () => {
    const series = build([
      tx({ id: 'a', category: 'groceries', amountMinorUnits: -30_00, time: JAN }),
      tx({ id: 'b', category: 'transport', amountMinorUnits: -80_00, time: JAN }),
    ]);

    expect(series.map((entry) => entry.key)).toEqual(['transport', 'groceries']);
  });

  it('returns an empty array for empty input', () => {
    expect(build([])).toEqual([]);
  });
});
