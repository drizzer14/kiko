// `buildNetWorthSeries` uses `rateTableAt` from the rate-history repo, whose
// module opens the op-sqlite connection at load. Stub the native module so the
// (pure) builder can be exercised without a real database.
import type { CurrencyRateHistoryRow, HoldingRow } from '../db/schema';

import type { SeriesHolding } from './holding-value-at';
import { buildNetWorthSeries, type NetWorthSeries } from './net-worth-series';

const DAY = 86_400_000;
const HOUR = 3_600_000;
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

  it('carries the earliest stored rate backward to buckets before the first history day', () => {
    // The UAH holding's only rate row starts on D1. Without carrying the earliest
    // rate backward, the D0 bucket would omit UAH entirely and understate the
    // start; instead D0 is priced at D1's (earliest) rate.
    const holdings = [holding({ id: 'uah', currency: 'UAH', balanceMinorUnits: 400_000 })]; // 4000 UAH
    const historyRows = [uahUsd(D1, '0.05')];

    const series = buildNetWorthSeries({
      holdings,
      txByHolding: new Map(),
      historyRows,
      baseCurrency: 'USD',
      range: { from: D0, to: D1 },
    });

    // D0 carries D1's 0.05 backward: 4000 * 0.05 = $200 (not $0 from a dropped holding).
    expect(series.points.map((point) => point.amount)).toEqual([200, 200]);
    expect(series.startReference).toBe(200);
  });

  it('values the current-day bucket at the live rate table, not the historical one', () => {
    // The line's historical rate for today (NBU official) differs from the app's
    // live monobank BUY rate used by the headline/bar/pie. To reconcile, the most
    // recent bucket is valued at the live table so its “now” point matches them.
    const holdings = [holding({ id: 'uah', currency: 'UAH', balanceMinorUnits: 400_000 })]; // 4000 UAH
    const historyRows = [uahUsd(D0, '0.025'), uahUsd(D1, '0.025')];

    const series = buildNetWorthSeries({
      holdings,
      txByHolding: new Map(),
      historyRows,
      baseCurrency: 'USD',
      range: { from: D0, to: D1 },
      liveRateTable: { 'UAH:USD': 0.05 },
      today: D1,
    });

    // D0 (a past day) stays on the historical 0.025 -> $100; D1 (today) uses the
    // live 0.05 -> $200.
    expect(series.points.map((point) => point.amount)).toEqual([100, 200]);
  });

  it('resolves the rate for an intraday bucket instant to that UTC day’s row', () => {
    // History `day` is UTC-midnight; a bucket instant partway through the day must
    // still resolve to that day's rate rather than sliding to an adjacent day.
    const holdings = [holding({ id: 'uah', currency: 'UAH', balanceMinorUnits: 400_000 })];
    const historyRows = [uahUsd(D0, '0.025'), uahUsd(D1, '0.05')];

    const series = buildNetWorthSeries({
      holdings,
      txByHolding: new Map(),
      historyRows,
      baseCurrency: 'USD',
      range: { from: D0 + 13 * HOUR, to: D1 + 13 * HOUR },
    });

    // Both buckets sit 13h into their UTC day and pick up that day's rate:
    // D0 -> 4000 * 0.025 = $100, D1 -> 4000 * 0.05 = $200.
    expect(series.points.map((point) => point.amount)).toEqual([100, 200]);
  });

  it('stays flat across a same-day card->bond move (the bond turns on for the whole day)', () => {
    // A card->bond move is asset-neutral: the card debit and the bond purchase
    // are two facts co-dated on the same day D. The bond value must turn on for
    // the WHOLE local day D so the offsetting asset is credited on the same day
    // the card drops, keeping the net-worth line flat. `purchaseDate` is a
    // mid-day timestamp (the holding-form default `purchaseDate ?? Date.now()`).
    const dayD = D1;
    const debitTime = dayD + 6 * HOUR; // 06:00 on day D
    const purchaseDate = dayD + 18 * HOUR; // 18:00 on day D (a mid-day timestamp)
    const bucketDayD = dayD + 12 * HOUR; // the day-D bucket sits at noon, between them

    // Card started with $100 and was debited $100, so its current balance is 0.
    const card = holding({ id: 'card', currency: 'USD', balanceMinorUnits: 0 });
    const bond = holding({
      id: 'bond',
      currency: 'USD',
      type: 'bond',
      balanceMinorUnits: 0,
      metadata: {
        quantity: 1,
        faceValueMinorUnits: 10_000, // nominal $100.00
        couponPct: 0,
        couponFrequency: 'annually',
        bondKind: 'government',
        purchaseDate,
        purchasePriceMinorUnits: 10_000,
        maturityDate: Date.UTC(2027, 0, 1),
      },
    });

    const series = buildNetWorthSeries({
      holdings: [card, bond],
      txByHolding: new Map([['card', [{ time: debitTime, amountMinorUnits: -10_000 }]]]),
      historyRows: [uahUsd(D0, '0.025')], // present only to pass the no-history guard
      baseCurrency: 'USD',
      range: { from: D0 + 12 * HOUR, to: D0 + 2 * DAY + 12 * HOUR },
    });

    const amountAt = (t: number): number => {
      const point = series.points.find((candidate) => candidate.t === t);
      if (point === undefined) {
        throw new Error(`no bucket at ${t}`);
      }
      return point.amount;
    };

    // Day D (bond bought, card debited) must equal day D-1 (card still full): $100.
    expect(amountAt(bucketDayD)).toBe(amountAt(D0 + 12 * HOUR));
    expect(amountAt(bucketDayD)).toBe(100);
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
