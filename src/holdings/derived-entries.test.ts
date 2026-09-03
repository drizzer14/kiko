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
  it('derives the full lifecycle inline for a recap-on deposit', () => {
    // The real monobank deposit: opened 11 Jan 2026 with 100,000.00 at 16%
    // bi-weekly, +50,000.00 on 10 Feb. The first accrual [12.01-31.01] is
    // 876.71 gross with 157.81 income tax + 43.84 military levy; the 12 Feb
    // accrual capitalizes both February periods (+1063.22 net here).
    const holding: Holding = {
      id: 'h1',
      type: 'term_deposit',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: {
        contributions: [
          { amountMinorUnits: 100_000_00, date: local(2026, 0, 11) },
          { amountMinorUnits: 50_000_00, date: local(2026, 1, 10) },
        ],
        annualRatePct: 16,
        termMonths: 12,
        recapitalization: true,
        compounding: 'bi-weekly',
      },
    };
    const now = local(2026, 8, 2);

    const entries = derivedEntries(holding, now);

    // The opening deposit and the top-up lead, labelled distinctly.
    const contributions = entries.filter((e) => e.kind === 'contribution');
    expect(contributions.map((e) => e.label)).toEqual(['Opening deposit', 'Top-up']);
    expect(contributions[0].amountMinorUnits).toBe(100_000_00);

    // The first interest accrual and its two withholding lines, dated 1 Feb.
    const firstAccrual = entries.find((e) => e.kind === 'accrual');
    expect(firstAccrual).toMatchObject({
      time: local(2026, 1, 1),
      amountMinorUnits: 87_671,
      label: 'Interest accrual',
      isFuture: false,
      derived: true,
    });
    const firstIncome = entries.find((e) => e.kind === 'income-tax');
    expect(firstIncome).toMatchObject({ amountMinorUnits: -15_781, label: 'Income tax 18%' });
    const firstMilitary = entries.find((e) => e.kind === 'military-levy');
    expect(firstMilitary).toMatchObject({ amountMinorUnits: -4_384, label: 'Military levy 5%' });

    // The 12 Feb capitalization folds both February periods' net into the balance.
    const firstCap = entries.find((e) => e.kind === 'capitalization');
    expect(firstCap).toMatchObject({
      time: local(2026, 1, 12),
      amountMinorUnits: 106_322,
      label: 'Capitalization',
      isFuture: false,
    });

    // Accruals whose capitalization is still ahead are projected (dimmed): the
    // deposit runs to Jan 2027, so late accruals are future-dated.
    expect(entries.some((e) => e.kind === 'accrual' && e.isFuture)).toBe(true);
  });

  it('sorts the lifecycle oldest-first and keeps same-instant lines grouped', () => {
    const holding: Holding = {
      id: 'grp',
      type: 'term_deposit',
      currency: 'UAH',
      balanceMinorUnits: 0,
      metadata: {
        contributions: [{ amountMinorUnits: 100_000_00, date: local(2026, 0, 11) }],
        annualRatePct: 16,
        termMonths: 12,
        recapitalization: true,
        compounding: 'bi-weekly',
      },
    };
    const entries = derivedEntries(holding, local(2026, 2, 1));
    // Non-decreasing by time overall.
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i].time).toBeGreaterThanOrEqual(entries[i - 1].time);
    }
    // The 1 Feb accrual line precedes its income and military lines (same instant).
    const feb1 = entries.filter((e) => e.time === local(2026, 1, 1)).map((e) => e.kind);
    expect(feb1).toEqual(['accrual', 'income-tax', 'military-levy']);
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
    expect(tax?.amountMinorUnits).toBe(-23_000); // round(18%) + round(5%) of 1000.00
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
