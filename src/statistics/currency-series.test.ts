import type { HoldingRow } from '../db/schema';
import { buildCurrencySeries, type SeriesHolding } from './currency-series';

const DAY = 86_400_000;
const D0 = Date.UTC(2026, 0, 1);
const D1 = D0 + DAY;
const D2 = D0 + 2 * DAY;

const holding = (over: Partial<HoldingRow> & Pick<HoldingRow, 'id'>): SeriesHolding => ({
  currency: 'UAH',
  type: 'cash',
  balanceMinorUnits: 0,
  metadata: null,
  ...over,
});

describe('buildCurrencySeries', () => {
  it('sums two holdings of one currency into a single day-bucketed, indexed line', () => {
    const holdings = [
      holding({ id: 'a', balanceMinorUnits: 150_000 }), // opening 100_000 (+50_000 at D1)
      holding({ id: 'b', balanceMinorUnits: 60_000 }), // opening 40_000 (+20_000 at D2)
    ];
    const txByHolding = new Map([
      ['a', [{ time: D1, amountMinorUnits: 50_000 }]],
      ['b', [{ time: D2, amountMinorUnits: 20_000 }]],
    ]);

    const series = buildCurrencySeries({ holdings, txByHolding, range: { from: D0, to: D2 } });

    expect(series).toHaveLength(1);
    const uah = series[0];
    expect(uah.currency).toBe('UAH');
    expect(uah.points.map((point) => point.t)).toEqual([D0, D1, D2]);
    // start 140_000; D1 190_000; D2 210_000
    expect(uah.points[0].pct).toBe(0);
    expect(uah.points[1].pct).toBeCloseTo(35.714, 2);
    expect(uah.points[2].pct).toBeCloseTo(50, 5);
  });

  it('values a term deposit via holdingValueBreakdown so the line rises with accrued interest', () => {
    const holdings = [
      holding({
        id: 'dep',
        type: 'term_deposit',
        balanceMinorUnits: 100_000,
        metadata: {
          contributions: [{ amountMinorUnits: 100_000, date: D0 }],
          annualRatePct: 12,
          termMonths: 24,
          recapitalization: true,
          compounding: 'monthly',
        },
      }),
    ];
    // No transactions: the rise comes purely from accrued interest.
    const series = buildCurrencySeries({
      holdings,
      txByHolding: new Map(),
      range: { from: D0, to: D0 + 90 * DAY },
    });

    const points = series[0].points;
    expect(points[0].pct).toBe(0);
    expect(points[points.length - 1].pct).toBeGreaterThan(0);
  });

  it('reconstructs the start-of-range base from the current balance minus later transactions', () => {
    // Created before the range; a +40_000 deposit lands inside it. Current
    // balance 100_000 -> opening 60_000, so D0 indexes against 60_000.
    const holdings = [holding({ id: 'a', balanceMinorUnits: 100_000 })];
    const txByHolding = new Map([['a', [{ time: D1, amountMinorUnits: 40_000 }]]]);

    const series = buildCurrencySeries({ holdings, txByHolding, range: { from: D0, to: D1 } });

    const points = series[0].points;
    expect(points[0].pct).toBe(0); // base 60_000
    expect(points[1].pct).toBeCloseTo(66.667, 2); // 100_000 / 60_000
  });

  it('guards a zero start value by indexing against the first non-zero bucket', () => {
    // opening 0 (150_000 current = 50_000 @ D1 + 50_000 @ D2). Leading zero
    // buckets report 0%; the series is indexed to the first non-zero value.
    const holdings = [holding({ id: 'a', balanceMinorUnits: 100_000 })];
    const txByHolding = new Map([
      [
        'a',
        [
          { time: D1, amountMinorUnits: 50_000 },
          { time: D2, amountMinorUnits: 50_000 },
        ],
      ],
    ]);

    const series = buildCurrencySeries({ holdings, txByHolding, range: { from: D0, to: D2 } });

    const points = series[0].points;
    expect(points[0].pct).toBe(0); // leading zero bucket
    expect(points[1].pct).toBe(0); // first non-zero -> baseline, 0%
    expect(points[2].pct).toBe(100); // 100_000 / 50_000
  });

  it('reports a flat zero line when a currency has no value across the whole range', () => {
    const holdings = [holding({ id: 'a', balanceMinorUnits: 0 })];

    const series = buildCurrencySeries({
      holdings,
      txByHolding: new Map(),
      range: { from: D0, to: D2 },
    });

    expect(series[0].points.every((point) => point.pct === 0)).toBe(true);
  });
});
