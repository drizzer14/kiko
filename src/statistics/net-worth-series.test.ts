// `buildNetWorthSeries` uses `rateTableAt` from the rate-history repo, whose
// module opens the op-sqlite connection at load. Stub the native module so the
// (pure) builder can be exercised without a real database.
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

import type { CurrencyRateHistoryRow, HoldingRow } from '../db/schema';
import type { SeriesHolding } from './holding-value-at';
import { buildNetWorthSeries, type NetWorthSeries } from './net-worth-series';

const DAY = 86_400_000;
const D0 = Date.UTC(2026, 0, 1);
const D1 = D0 + DAY;
const D2 = D0 + 2 * DAY;

const holding = (over: Partial<HoldingRow> & Pick<HoldingRow, 'id'>): SeriesHolding => ({
  currency: 'USD',
  type: 'cash',
  balanceMinorUnits: 0,
  metadata: null,
  ...over,
});

type HistoryRow = Pick<CurrencyRateHistoryRow, 'base' | 'quote' | 'day' | 'rate'>;

const uahUsd = (day: number, rate: string): HistoryRow => ({
  base: 'UAH',
  quote: 'USD',
  day,
  rate,
});

describe('buildNetWorthSeries', () => {
  it('converts holdings across currencies at each day’s historical rate', () => {
    const holdings = [
      holding({ id: 'usd', currency: 'USD', balanceMinorUnits: 10_000 }), // $100.00
      holding({ id: 'uah', currency: 'UAH', balanceMinorUnits: 400_000 }), // 4000.00 UAH
      holding({ id: 'btc', currency: 'BTC', balanceMinorUnits: 100_000_000 }), // no rate -> skipped
    ];
    // UAH strengthens against USD from day 0 to day 1.
    const historyRows = [uahUsd(D0, '0.025'), uahUsd(D1, '0.05')];

    const series = buildNetWorthSeries({
      holdings,
      txByHolding: new Map(),
      historyRows,
      baseCurrency: 'USD',
      range: { from: D0, to: D1 },
    });

    // D0: $100 + 4000*0.025=$100 -> $200. D1: $100 + 4000*0.05=$200 -> $300.
    expect(series.points).toEqual([
      { t: D0, amount: 200 },
      { t: D1, amount: 300 },
    ]);
  });

  it('carries the last available rate forward across a day with no rate row', () => {
    const holdings = [
      holding({ id: 'usd', currency: 'USD', balanceMinorUnits: 10_000 }), // $100.00
      holding({ id: 'uah', currency: 'UAH', balanceMinorUnits: 400_000 }), // 4000.00 UAH
    ];
    // A rate on D0 and D2 but a GAP on D1: D1 must reuse D0's carried-forward rate.
    const historyRows = [uahUsd(D0, '0.025'), uahUsd(D2, '0.05')];

    const series = buildNetWorthSeries({
      holdings,
      txByHolding: new Map(),
      historyRows,
      baseCurrency: 'USD',
      range: { from: D0, to: D2 },
    });

    expect(series.points.map((point) => point.amount)).toEqual([200, 200, 300]);
  });

  it('reports startReference as the value at the range start', () => {
    const holdings = [holding({ id: 'usd', currency: 'USD', balanceMinorUnits: 5_000 })]; // $50.00
    const historyRows = [uahUsd(D0, '0.025')];

    const series = buildNetWorthSeries({
      holdings,
      txByHolding: new Map(),
      historyRows,
      baseCurrency: 'USD',
      range: { from: D0, to: D1 },
    });

    expect(series.startReference).toBe(50);
    expect(series.startReference).toBe(series.points[0].amount);
  });

  it('returns an empty series when no history has been backfilled yet', () => {
    const holdings = [holding({ id: 'usd', currency: 'USD', balanceMinorUnits: 10_000 })];

    const series: NetWorthSeries = buildNetWorthSeries({
      holdings,
      txByHolding: new Map(),
      historyRows: [],
      baseCurrency: 'USD',
      range: { from: D0, to: D2 },
    });

    expect(series).toEqual({ points: [], startReference: 0 });
  });
});
