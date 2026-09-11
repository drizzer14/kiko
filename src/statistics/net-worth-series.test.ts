// `buildNetWorthSeries` uses `rateTableAt` from the rate-history repo, whose
// module opens the op-sqlite connection at load. Stub the native module so the
// (pure) builder can be exercised without a real database.
import { startOfLocalDay } from '../dates/local-day';
import type { CurrencyRateHistoryRow, HoldingRow } from '../db/schema';
import type { MonobankStatementItem } from '../monobank/monobank.types';
// `sync.ts` itself imports the repos, which open the op-sqlite connection at
// load — `jest/setup.js` mocks `@op-engineering/op-sqlite` globally, so this
// module graph loads safely under Jest and `mapStatementItem` runs for real.
import { mapStatementItem } from '../monobank/sync';

import type { SeriesHolding } from './holding-value-at';
import { buildNetWorthSeries, type NetWorthSeries } from './net-worth-series';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const D0 = Date.UTC(2026, 0, 1);
const D1 = D0 + DAY;
const D2 = D0 + 2 * DAY;

// Local midnight of the calendar day `n` days after `t`. Built from local Y/M/D
// fields (never a fixed ms offset) so the cross-day fixtures below map onto the
// SAME local calendar days that `startOfLocalDay` compares in production, on any
// machine timezone — the suite's `Date.UTC` boundaries are not local midnight on
// a non-zero-offset box (this repo's dev machine is Europe/Kyiv).
const addLocalDays = (t: number, n: number): number => {
  const date = new Date(t);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n).getTime();
};

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

  it('stays flat across a same-day card->bond move for a PREMIUM bond (valued at cost)', () => {
    // A PREMIUM bond: $107.87 paid for a $100.00 nominal. The card is debited the
    // price PAID. Valuing the live bond at cost (not nominal) makes the move
    // net-worth-neutral; valuing at nominal would leave a permanent $7.87 dip
    // until maturity (the R4 bug).
    const dayD = D1;
    const debitTime = dayD + 6 * HOUR; // 06:00 on day D
    const purchaseDate = dayD + 18 * HOUR; // 18:00 on day D (a mid-day timestamp)
    const bucketDayD = dayD + 12 * HOUR; // the day-D bucket sits at noon, between them

    // Card started with $107.87 and was debited $107.87, so its current balance is 0.
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
        purchasePriceMinorUnits: 10_787, // paid $107.87 (a premium over the $100.00 nominal)
        maturityDate: Date.UTC(2027, 0, 1),
      },
    });

    const series = buildNetWorthSeries({
      holdings: [card, bond],
      txByHolding: new Map([['card', [{ time: debitTime, amountMinorUnits: -10_787 }]]]),
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

    // Day D (bond bought at cost, card debited the same price) must equal day D-1
    // (card still full): $107.87.
    expect(amountAt(bucketDayD)).toBe(amountAt(D0 + 12 * HOUR));
    expect(amountAt(bucketDayD)).toBe(107.87);
  });

  it('stays flat across a same-day card->bond move when the synced debit ≠ the typed price', () => {
    // The real synced case. The card is debited the ACTUAL amount that left (Q =
    // $1100.00 — a fee / accrued-coupon (НКД) / rounded "roughly the price"),
    // while the user typed a slightly different price (P = $1078.68). Recognizing
    // the bond at the TYPED price leaves a permanent (Q − P) = $21.32 dip from the
    // purchase day on, because the two legs are drawn from unrelated paths and
    // never cancel. Reconciling the bond's held cost to the matched debit's amount
    // (Q) makes the move net-worth-neutral: the card's −Q and the bond's +Q cancel.
    const dayD = D1;
    const debitTime = dayD + 6 * HOUR; // 06:00 on day D
    const purchaseDate = dayD + 18 * HOUR; // 18:00 on day D (a mid-day timestamp)
    const bucketDayD = dayD + 12 * HOUR; // the day-D bucket sits at noon, between them

    // Card started with $1100.00 and was debited $1100.00, so its current balance is 0.
    const card = holding({ id: 'card', currency: 'USD', balanceMinorUnits: 0 });
    const bond = holding({
      id: 'bond',
      currency: 'USD',
      type: 'bond',
      balanceMinorUnits: 0,
      metadata: {
        quantity: 1,
        faceValueMinorUnits: 100_000, // nominal $1000.00
        couponPct: 0,
        couponFrequency: 'annually',
        bondKind: 'government',
        purchaseDate,
        purchasePriceMinorUnits: 107_868, // user typed $1078.68 (roughly the price)
        maturityDate: Date.UTC(2027, 0, 1),
      },
    });

    const series = buildNetWorthSeries({
      holdings: [card, bond],
      // The synced debit is $1100.00 — NOT equal to the typed $1078.68 price.
      txByHolding: new Map([['card', [{ time: debitTime, amountMinorUnits: -110_000 }]]]),
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

    // Day D (bond bought, card debited Q) must equal day D-1 (card still full): the
    // bond is recognized at the matched debit's amount Q = $1100.00, so no dip.
    expect(amountAt(bucketDayD)).toBe(amountAt(D0 + 12 * HOUR));
    expect(amountAt(bucketDayD)).toBe(1100);
  });

  it('stays flat through the REAL monobank statement->transaction mapping when the synced debit ≠ the typed price', () => {
    // REGRESSION for the reported bug, driven through the actual sync data path
    // instead of a hand-built fixture.
    //
    // Every OTHER bond case above builds `txByHolding` from a literal
    // `{ time, amountMinorUnits }` object — including the "synced debit ≠ typed
    // price" case just above this one, which types `amountMinorUnits: -110_000`
    // directly into a `SeriesTransaction`. That proves `reconcileBondFunding`'s
    // amount-tolerance MATCHING logic is correct, but it never touches the code
    // that actually turns a Monobank statement item into a stored transaction —
    // it assumes the sign and the minor-units scale are already right. This is
    // exactly the shortcut every EARLIER same-day bond test also took, just with
    // Q hardcoded to equal P instead of a hand-typed near-P figure: the dip
    // never showed up in ANY unit test that skips `mapStatementItem` and asserts
    // on a hand-picked `amountMinorUnits`, because that number was never derived
    // from anything the mapping could get wrong (a flipped sign, an unconverted
    // major-unit amount, an un-scaled timestamp).
    //
    // This test instead builds a plain `MonobankStatementItem` — the exact wire
    // shape `GET /personal/statement/...` returns (`src/monobank/monobank.types.d.ts`)
    // — and threads it through the REAL, exported `mapStatementItem` from
    // `src/monobank/sync.ts` (the same function `mapFetched`/`importAccount` call
    // in production) to produce the funding debit, rather than typing
    // `amountMinorUnits` by hand. That exercises the real sign/unit convention
    // (`item.amount` already a signed integer in minor units per kiko-architecture
    // — no float conversion) and the real seconds->milliseconds time conversion
    // (`item.time * 1000`), so a regression in that mapping (not just in
    // `reconcileBondFunding`'s matching) would also be caught here.
    //
    // Boundary not crossed: `fetchAllStatements`/`runSyncInner` (the network
    // fetch + op-sqlite transaction write) need a real device/native op-sqlite
    // and a live Monobank connection, so they cannot run in a Jest unit test.
    // `mapStatementItem` is the exact, real, pure transform between the wire
    // item and the stored transaction shape — the closest point in the real
    // pipeline this scenario can be driven from without a device.
    const dayD = D1;
    const debitSeconds = Math.floor((dayD + 6 * HOUR) / 1000); // Monobank times are unix SECONDS
    const purchaseDate = dayD + 18 * HOUR; // 18:00 on day D (a mid-day timestamp)
    const bucketDayD = dayD + 12 * HOUR;

    // A realistic Monobank statement item for a bond purchase: MCC 6211
    // (Securities - Brokers/Dealers), a Ukrainian bond-purchase description, and
    // `amount` already the ACTUAL debited minor units (Q = $1100.00) — NOT equal
    // to the price the user will type on the bond form (P = $1078.68, a ~2% gap
    // from a broker fee / accrued coupon interest / rounding).
    const bondPurchaseItem: MonobankStatementItem = {
      id: 'stmt-bond-1',
      time: debitSeconds,
      description: 'Купівля облігацій',
      mcc: 6211,
      originalMcc: 6211,
      hold: false,
      amount: -110_000, // Q: the ACTUAL debit, in minor units, already signed negative
      operationAmount: -110_000,
      currencyCode: 840, // ISO 4217 numeric for USD
      commissionRate: 0,
      cashbackAmount: 0,
      balance: 0,
    };

    // The REAL mapping function under test: production calls this exact
    // function (`mapFetched` -> `mapStatementItem`) for every synced item.
    const debitTransaction = mapStatementItem(bondPurchaseItem, 'card');
    // Prove the mapping actually did the sign/scale/unit conversion this test
    // depends on, rather than trusting the fixture literal: the mapped
    // transaction's amount is the wire item's `amount` verbatim (no float
    // rescale), and its time is the wire item's seconds converted to
    // milliseconds — the two facts `buildNetWorthSeries`/`reconcileBondFunding`
    // read below.
    expect(debitTransaction.amountMinorUnits).toBe(bondPurchaseItem.amount);
    expect(debitTransaction.time).toBe(bondPurchaseItem.time * 1000);

    // Card started with $1100.00 and was debited $1100.00 (via the real mapped
    // transaction), so its current balance is 0.
    const card = holding({ id: 'card', currency: 'USD', balanceMinorUnits: 0 });
    const bond = holding({
      id: 'bond',
      currency: 'USD',
      type: 'bond',
      balanceMinorUnits: 0,
      metadata: {
        quantity: 1,
        faceValueMinorUnits: 100_000, // nominal $1000.00
        couponPct: 0,
        couponFrequency: 'annually',
        bondKind: 'government',
        purchaseDate,
        purchasePriceMinorUnits: 107_868, // P: user typed $1078.68 (roughly the price)
        maturityDate: Date.UTC(2027, 0, 1),
      },
    });

    const series = buildNetWorthSeries({
      holdings: [card, bond],
      // The card's ledger holds the transaction the REAL mapping produced — not
      // a hand-typed `{ time, amountMinorUnits }` literal.
      txByHolding: new Map([['card', [debitTransaction]]]),
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

    // Net worth must be FLAT across the purchase day: day D-1 (card still full,
    // bond not yet recognized) must equal day D (bond bought, card debited by
    // the real synced Q) — no permanent (Q - P) = $21.32 dip.
    expect(amountAt(bucketDayD)).toBe(amountAt(D0 + 12 * HOUR));
    expect(amountAt(bucketDayD)).toBe(1100);
  });

  it('does not treat an unrelated same-currency debit far from the price as the funding outflow', () => {
    // A guard: a debit whose amount is NOWHERE near the bond's price (here 4× the
    // price) is not the bond's funding outflow. It must NOT be reconciled onto the
    // bond — neither its day nor its amount — so the bond falls back to the typed
    // purchase day and typed price and STEPS net worth up there, and the day-D0
    // bucket (where the unrelated debit lands) is NOT inflated by a bond value.
    const purchaseDate = D1 + 18 * HOUR; // typed mid-day timestamp on day D1

    const cash = holding({ id: 'cash', currency: 'USD', balanceMinorUnits: 20_000 }); // $200, untouched
    // Card started with $400 and was debited $400 on D0 (unrelated spend), balance 0.
    const card = holding({ id: 'card', currency: 'USD', balanceMinorUnits: 0 });
    const bond = holding({
      id: 'bond',
      currency: 'USD',
      type: 'bond',
      balanceMinorUnits: 0,
      metadata: {
        quantity: 1,
        faceValueMinorUnits: 10_000,
        couponPct: 0,
        couponFrequency: 'annually',
        bondKind: 'government',
        purchaseDate,
        purchasePriceMinorUnits: 10_000, // $100.00 — the $400 debit is 4× this, outside tolerance
        maturityDate: Date.UTC(2027, 0, 1),
      },
    });

    const series = buildNetWorthSeries({
      holdings: [cash, card, bond],
      txByHolding: new Map([['card', [{ time: D0 + 6 * HOUR, amountMinorUnits: -40_000 }]]]),
      historyRows: [uahUsd(D0, '0.025')], // present only to pass the no-history guard
      baseCurrency: 'USD',
      range: { from: D0, to: D2 },
    });

    const amountAt = (t: number): number => {
      const point = series.points.find((candidate) => candidate.t === t);
      if (point === undefined) {
        throw new Error(`no bucket at ${t}`);
      }

      return point.amount;
    };

    // D0: only cash ($200) — the bond has NOT been mis-recognized onto the $400
    // debit's day/amount (that would inflate this bucket to $600).
    expect(amountAt(D0)).toBe(200);
    // D1 (typed purchase day) and D2: the bond turns on at its typed price and
    // STEPS net worth up by $100, unaffected by the unrelated debit — $300.
    expect(amountAt(D1)).toBe(300);
    expect(amountAt(D2)).toBe(300);
  });

  it('stays flat across a card->bond move sampled at LOCAL MIDNIGHT buckets (premium, at cost)', () => {
    // Production samples daily buckets at LOCAL MIDNIGHT (tests run in UTC, so
    // startOfLocalDay == UTC midnight). A mid-day card debit and a same-local-day
    // bond purchase must land in the SAME bucket: the running balance has to apply
    // the debit by LOCAL DAY, matching the bond valuation which turns on by local
    // day at the purchase-day midnight bucket. Applying the debit by RAW INSTANT
    // instead defers it to the next day's bucket while the bond's cost turns on at
    // the purchase-day midnight bucket, so the day-D midnight bucket spikes to
    // 215.74 (both assets counted) instead of staying at the neutral 107.87.
    const dayD = D1; // a UTC/local-midnight day boundary
    const debitTime = dayD + 15 * HOUR; // 15:00 on day D (a mid-day timestamp)

    // Card started with $107.87 and was debited $107.87, so its current balance is 0.
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
        purchaseDate: dayD, // UTC/local midnight of day D
        purchasePriceMinorUnits: 10_787, // paid $107.87 (a premium over the $100.00 nominal)
        maturityDate: Date.UTC(2027, 0, 1),
      },
    });

    const series = buildNetWorthSeries({
      holdings: [card, bond],
      txByHolding: new Map([['card', [{ time: debitTime, amountMinorUnits: -10_787 }]]]),
      historyRows: [uahUsd(D0, '0.025')], // present only to pass the no-history guard
      baseCurrency: 'USD',
      range: { from: D0, to: D0 + 2 * DAY }, // buckets at D0, D1 (=dayD), D2 — all midnight
    });

    const amountAt = (t: number): number => {
      const point = series.points.find((candidate) => candidate.t === t);
      if (point === undefined) {
        throw new Error(`no bucket at ${t}`);
      }
      return point.amount;
    };

    // Day-D midnight bucket (bond bought at cost, card debited the same price) must
    // equal the day-(D-1) midnight bucket (card still full): $107.87.
    expect(amountAt(dayD)).toBe(amountAt(D0));
    expect(amountAt(dayD)).toBe(107.87);
  });

  it('stays flat across a CROSS-day card->bond move (funding debit dated BEFORE purchaseDate)', () => {
    // The surviving bond-dip bug. A card->bond move is two independently-dated
    // facts: a real funding DEBIT on the card (a Monobank "Купівля облігацій"
    // row) and a bond whose cost turns on at the user-typed `purchaseDate`. When
    // the debit's local day is EARLIER than `purchaseDate`'s local day, the card
    // drops during the gap while the bond is still 0, so net worth dips. Aligning
    // the bond's cost recognition to the funding-debit day closes the gap.
    const dayDm1 = startOfLocalDay(Date.UTC(2026, 0, 5, 12)); // a winter day (no DST step)
    const dayD = addLocalDays(dayDm1, 1); // funding debit lands here
    const dayD1 = addLocalDays(dayDm1, 2);
    const dayD2 = addLocalDays(dayDm1, 3); // typed purchaseDate lands here (D+2)

    const debitTime = dayD + 6 * HOUR; // 06:00 local on day D
    const purchaseDate = dayD2 + 18 * HOUR; // 18:00 local on day D+2 (a mid-day timestamp)

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
        purchasePriceMinorUnits: 10_000, // paid $100.00
        maturityDate: Date.UTC(2027, 0, 1),
      },
    });

    const series = buildNetWorthSeries({
      holdings: [card, bond],
      txByHolding: new Map([['card', [{ time: debitTime, amountMinorUnits: -10_000 }]]]),
      historyRows: [uahUsd(D0, '0.025')], // present only to pass the no-history guard
      baseCurrency: 'USD',
      range: { from: dayDm1, to: dayD2 },
    });

    const amountAt = (t: number): number => {
      const point = series.points.find((candidate) => candidate.t === t);
      if (point === undefined) {
        throw new Error(`no bucket at ${t}`);
      }
      return point.amount;
    };

    // Every bucket from the gap day D through the typed purchase day D+2 must equal
    // the pre-move net worth ($100): the money left on day D, so the bond's cost
    // is recognized from day D and there is no dip on D or D+1.
    expect(amountAt(dayDm1)).toBe(100);
    expect(amountAt(dayD)).toBe(100);
    expect(amountAt(dayD1)).toBe(100);
    expect(amountAt(dayD2)).toBe(100);
  });

  it('stays flat across a CROSS-day card->bond move (funding debit dated AFTER purchaseDate)', () => {
    // The symmetric case: the funding debit's local day is LATER than the typed
    // `purchaseDate`. Recognizing the bond's cost from the typed day while the
    // card is still full would BUMP net worth across the gap. Aligning cost
    // recognition to the (later) funding-debit day keeps the move neutral.
    const dayDm1 = startOfLocalDay(Date.UTC(2026, 0, 5, 12)); // a winter day (no DST step)
    const dayD = addLocalDays(dayDm1, 1); // typed purchaseDate lands here
    const dayD1 = addLocalDays(dayDm1, 2);
    const dayD2 = addLocalDays(dayDm1, 3); // funding debit lands here (D+2)

    const purchaseDate = dayD + 18 * HOUR; // 18:00 local on day D (a mid-day timestamp)
    const debitTime = dayD2 + 6 * HOUR; // 06:00 local on day D+2

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
        purchasePriceMinorUnits: 10_000, // paid $100.00
        maturityDate: Date.UTC(2027, 0, 1),
      },
    });

    const series = buildNetWorthSeries({
      holdings: [card, bond],
      txByHolding: new Map([['card', [{ time: debitTime, amountMinorUnits: -10_000 }]]]),
      historyRows: [uahUsd(D0, '0.025')], // present only to pass the no-history guard
      baseCurrency: 'USD',
      range: { from: dayDm1, to: dayD2 },
    });

    const amountAt = (t: number): number => {
      const point = series.points.find((candidate) => candidate.t === t);
      if (point === undefined) {
        throw new Error(`no bucket at ${t}`);
      }
      return point.amount;
    };

    // No bump between the typed purchase day D and the later funding day D+2: the
    // bond's cost is recognized only from day D+2, when the money actually left.
    expect(amountAt(dayDm1)).toBe(100);
    expect(amountAt(dayD)).toBe(100);
    expect(amountAt(dayD1)).toBe(100);
    expect(amountAt(dayD2)).toBe(100);
  });

  it('turns a bond on at its typed purchaseDate when no funding debit matches (fallback, no regression)', () => {
    // A genuinely manual bond (cash bought outside the app, or funded before
    // transactions were tracked) has no recorded funding outflow at all. The
    // fix must not require a match to turn the bond on: `reconcileBondFunding`
    // falls back to the typed `purchaseDate`, so net worth should still STEP UP
    // there — proving the fix doesn't flatten a legitimately unfunded bond into
    // never showing its cost.
    const purchaseDate = D1 + 18 * HOUR; // mid-day timestamp on day D1

    const cash = holding({ id: 'cash', currency: 'USD', balanceMinorUnits: 20_000 }); // $200, untouched
    const bond = holding({
      id: 'bond',
      currency: 'USD',
      type: 'bond',
      balanceMinorUnits: 0,
      metadata: {
        quantity: 1,
        faceValueMinorUnits: 10_000,
        couponPct: 0,
        couponFrequency: 'annually',
        bondKind: 'government',
        purchaseDate,
        purchasePriceMinorUnits: 10_000, // paid $100.00
        maturityDate: Date.UTC(2027, 0, 1),
      },
    });

    const series = buildNetWorthSeries({
      holdings: [cash, bond],
      txByHolding: new Map(), // no transaction anywhere funds the bond's cost
      historyRows: [uahUsd(D0, '0.025')], // present only to pass the no-history guard
      baseCurrency: 'USD',
      range: { from: D0, to: D2 },
    });

    const amountAt = (t: number): number => {
      const point = series.points.find((candidate) => candidate.t === t);
      if (point === undefined) {
        throw new Error(`no bucket at ${t}`);
      }
      return point.amount;
    };

    // D0 (before purchaseDate's local day): the bond has not turned on yet.
    expect(amountAt(D0)).toBe(200);
    // D1 (purchaseDate's local day) and D2 (after): the bond turns ON at its
    // typed day and STEPS net worth up, since there is no offsetting debit to
    // net it against — the manual-bond path is unchanged by the fix.
    expect(amountAt(D1)).toBe(300);
    expect(amountAt(D2)).toBe(300);
  });

  describe('under an explicit non-host timezone (Kiritimati, UTC+14)', () => {
    // Every cross-day fixture above relies on the IMPLICIT host process
    // timezone (this repo's dev machine runs Europe/Kyiv, UTC+2/+3) via
    // `addLocalDays`/`startOfLocalDay`, which read `new Date(...)` in whatever
    // zone the process happens to be in. Pin an explicit, extreme, DST-free,
    // non-Kyiv, non-UTC offset so the same funding-day recognition is proven
    // independent of which machine runs the suite — not merely passing by
    // coincidence of the dev box's zone (a CI runner defaulting to UTC would
    // never have exercised the local-day arithmetic at all).
    const originalTz = process.env.TZ;

    beforeAll(() => {
      process.env.TZ = 'Pacific/Kiritimati';
    });

    afterAll(() => {
      process.env.TZ = originalTz;
    });

    it('still recognizes the funding-debit day across a one-day gap', () => {
      const purchaseDay = startOfLocalDay(Date.UTC(2026, 0, 10, 12));
      const debitDay = addLocalDays(purchaseDay, -1); // funded one calendar day earlier
      const debitTime = debitDay + 6 * HOUR;
      const purchaseDate = purchaseDay + 18 * HOUR;

      const cash = holding({ id: 'cash', currency: 'USD', balanceMinorUnits: 0 });
      const bond = holding({
        id: 'bond',
        currency: 'USD',
        type: 'bond',
        balanceMinorUnits: 0,
        metadata: {
          quantity: 1,
          faceValueMinorUnits: 10_000,
          couponPct: 0,
          couponFrequency: 'annually',
          bondKind: 'government',
          purchaseDate,
          purchasePriceMinorUnits: 10_000,
          maturityDate: Date.UTC(2027, 0, 1),
        },
      });

      const series = buildNetWorthSeries({
        holdings: [cash, bond],
        txByHolding: new Map([['cash', [{ time: debitTime, amountMinorUnits: -10_000 }]]]),
        historyRows: [uahUsd(D0, '0.025')],
        baseCurrency: 'USD',
        range: { from: debitDay, to: purchaseDay },
      });

      const at = (t: number): number => {
        const point = series.points.find((candidate) => candidate.t === t);
        if (point === undefined) {
          throw new Error(`no bucket at ${t}`);
        }
        return point.amount;
      };

      // The money left on the debit day, so the bond's cost is recognized from
      // there and net worth is $100 flat on both the debit day and the typed
      // purchase day — no dip, even under this far-flung timezone.
      expect(at(debitDay)).toBe(100);
      expect(at(purchaseDay)).toBe(100);
    });
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
