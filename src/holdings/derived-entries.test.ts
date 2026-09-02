import type { DerivedEntry, DerivedEntryKind } from './derived-entries';
import { derivedEntries } from './derived-entries';
import type { ValuableHolding } from './holding-value';

const DAY = 86_400_000;
const T0 = 1_600_000_000_000;

// Local-midnight instant, matching the local Date arithmetic the coupon-date
// helpers use.
const local = (year: number, monthIndex: number, day: number): number =>
  new Date(year, monthIndex, day).getTime();

type Holding = ValuableHolding & { id: string };

describe('derivedEntries', () => {
  it('derives contributions, interest and tax for a recap-on deposit', () => {
    const holding: Holding = {
      id: 'h1',
      type: 'term_deposit',
      currency: 'USD',
      balanceMinorUnits: 200_000,
      metadata: {
        contributions: [
          { amountMinorUnits: 100_000, date: T0 },
          { amountMinorUnits: 100_000, date: T0 + 30 * DAY },
        ],
        annualRatePct: 10,
        termMonths: 24,
        recapitalization: true,
        compounding: 'annually',
      },
    };
    const now = T0 + 400 * DAY;

    const entries = derivedEntries(holding, now);

    const expected: DerivedEntry[] = [
      {
        id: 'derived:h1:contribution:0',
        time: T0,
        amountMinorUnits: 100_000,
        label: 'Contribution',
        kind: 'contribution',
        isFuture: false,
        derived: true,
      },
      {
        id: 'derived:h1:contribution:1',
        time: T0 + 30 * DAY,
        amountMinorUnits: 100_000,
        label: 'Contribution',
        kind: 'contribution',
        isFuture: false,
        derived: true,
      },
      {
        id: 'derived:h1:interest:0',
        time: now,
        // Interest with calendar-anniversary compounding: the first 100,000
        // completes one annual period (+10,000) then accrues the trailing
        // ~35 days simple; the second 100,000 (dated T0+30d) accrues a partial
        // first period actual/365 to the annual boundary, then the trailing
        // partial. Total 21,280 — the old fixed-day compounding under-counted
        // this at 20,000.
        amountMinorUnits: 21_280,
        label: 'Interest',
        kind: 'interest',
        isFuture: false,
        derived: true,
      },
      {
        id: 'derived:h1:tax:0',
        time: now,
        // floor(21,280 * 23%) = 4,894.
        amountMinorUnits: -4_894,
        label: 'Tax',
        kind: 'tax',
        isFuture: false,
        derived: true,
      },
    ];
    expect(entries).toEqual(expected);

    // Rows are ordered by time: dated contributions precede the now-dated
    // interest/tax pair, with tax last.
    const kinds: DerivedEntryKind[] = entries.map((e) => e.kind);
    expect(kinds).toEqual(['contribution', 'contribution', 'interest', 'tax']);
  });

  it('emits interest and tax rows for a recap-off deposit', () => {
    const holding: Holding = {
      id: 'off',
      type: 'term_deposit',
      currency: 'UAH',
      balanceMinorUnits: 1_000_000,
      metadata: {
        // 10,000.00 UAH, 10% annual, monthly, interest paid out (recap-off).
        contributions: [{ amountMinorUnits: 1_000_000, date: T0 }],
        annualRatePct: 10,
        termMonths: 24,
        recapitalization: false,
        compounding: 'monthly',
      },
    };
    const now = T0 + 365 * DAY;

    const entries = derivedEntries(holding, now);

    expect(entries.map((e) => e.kind)).toEqual(['contribution', 'interest', 'tax']);
    const interest = entries.find((e) => e.kind === 'interest');
    const tax = entries.find((e) => e.kind === 'tax');
    expect(interest?.amountMinorUnits).toBe(100_000); // 1000.00 cumulative interest
    expect(tax?.amountMinorUnits).toBe(-23_000); // floor(23%) of 1000.00
  });

  it('returns [] for a term deposit with unparseable metadata', () => {
    const holding: Holding = {
      id: 'bad',
      type: 'term_deposit',
      currency: 'USD',
      balanceMinorUnits: 1000,
      metadata: { nonsense: true },
    };

    expect(derivedEntries(holding, T0)).toEqual([]);
  });

  it('derives purchase, each net coupon, and redemption for a government bond', () => {
    // Nominal 10,000.00 (10 * 1,000.00), 5% annual => 500.00 coupons. Coupons
    // step back from maturity: 15 Jan 2025 (past), 15 Jan 2026 and 1 Jan 2027
    // (future). Redemption of the nominal on the maturity date.
    const holding: Holding = {
      id: 'gov',
      type: 'bond',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: {
        quantity: 10,
        faceValueMinorUnits: 100_000, // 1,000.00 each => nominal 1,000,000 minor
        couponPct: 5,
        couponFrequency: 'annually',
        bondKind: 'government',
        purchaseDate: local(2025, 0, 1),
        maturityDate: local(2027, 0, 1),
      },
    };
    const now = local(2025, 5, 1); // 1 Jun 2025

    const entries = derivedEntries(holding, now);

    expect(entries).toEqual([
      {
        id: 'derived:gov:purchase:0',
        time: local(2025, 0, 1),
        amountMinorUnits: -1_000_000, // defaults price to nominal (paid at par)
        label: 'Purchase',
        kind: 'purchase',
        isFuture: false,
        derived: true,
      },
      {
        id: 'derived:gov:coupon:0',
        time: local(2025, 0, 15),
        amountMinorUnits: 50_000,
        label: 'Coupon',
        kind: 'coupon',
        isFuture: false,
        derived: true,
      },
      {
        id: 'derived:gov:coupon:1',
        time: local(2026, 0, 15),
        amountMinorUnits: 50_000,
        label: 'Coupon',
        kind: 'coupon',
        isFuture: true,
        derived: true,
      },
      {
        id: 'derived:gov:coupon:2',
        time: local(2027, 0, 1),
        amountMinorUnits: 50_000,
        label: 'Coupon',
        kind: 'coupon',
        isFuture: true,
        derived: true,
      },
      {
        id: 'derived:gov:redemption:0',
        time: local(2027, 0, 1),
        amountMinorUnits: 1_000_000,
        label: 'Redemption',
        kind: 'redemption',
        isFuture: true,
        derived: true,
      },
    ]);
    expect(entries.some((e) => e.kind === 'tax')).toBe(false);
  });

  it('pays a corporate bond coupon net of the 23% withholding, using the real price', () => {
    // Coupon 500.00 gross => net 500.00 - floor(23%) = 385.00 (38,500 minor).
    // Purchase entry uses the actual price paid, not the nominal.
    const holding: Holding = {
      id: 'corp',
      type: 'bond',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: {
        quantity: 10,
        faceValueMinorUnits: 100_000,
        couponPct: 5,
        couponFrequency: 'annually',
        bondKind: 'corporate',
        purchaseDate: local(2025, 0, 1),
        purchasePriceMinorUnits: 980_000, // paid below par
        maturityDate: local(2027, 0, 1),
      },
    };
    const now = local(2025, 5, 1);

    const entries = derivedEntries(holding, now);

    expect(entries[0]).toEqual({
      id: 'derived:corp:purchase:0',
      time: local(2025, 0, 1),
      amountMinorUnits: -980_000,
      label: 'Purchase',
      kind: 'purchase',
      isFuture: false,
      derived: true,
    });
    expect(entries.filter((e) => e.kind === 'coupon').map((e) => e.amountMinorUnits)).toEqual([
      38_500, 38_500, 38_500,
    ]);
    expect(entries.some((e) => e.kind === 'tax')).toBe(false);
  });

  it('returns [] for non deposit/bond holdings', () => {
    const card: Holding = {
      id: 'card',
      type: 'card',
      currency: 'USD',
      balanceMinorUnits: 500_000,
      metadata: null,
    };
    const cash: Holding = {
      id: 'cash',
      type: 'cash',
      currency: 'UAH',
      balanceMinorUnits: 12_345,
      metadata: null,
    };

    expect(derivedEntries(card, T0)).toEqual([]);
    expect(derivedEntries(cash, T0)).toEqual([]);
  });
});
