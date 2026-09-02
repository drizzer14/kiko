import type { DerivedEntry, DerivedEntryKind } from './derived-entries';
import { derivedEntries } from './derived-entries';
import type { ValuableHolding } from './holding-value';

const DAY = 86_400_000;
const T0 = 1_600_000_000_000;

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
        derived: true,
      },
      {
        id: 'derived:h1:contribution:1',
        time: T0 + 30 * DAY,
        amountMinorUnits: 100_000,
        label: 'Contribution',
        kind: 'contribution',
        derived: true,
      },
      {
        id: 'derived:h1:interest:0',
        time: now,
        amountMinorUnits: 20_000,
        label: 'Interest',
        kind: 'interest',
        derived: true,
      },
      {
        id: 'derived:h1:tax:0',
        time: now,
        amountMinorUnits: -4_600,
        label: 'Tax',
        kind: 'tax',
        derived: true,
      },
    ];
    expect(entries).toEqual(expected);

    // Rows are ordered by time: dated contributions precede the now-dated
    // interest/tax pair, with tax last.
    const kinds: DerivedEntryKind[] = entries.map((e) => e.kind);
    expect(kinds).toEqual(['contribution', 'contribution', 'interest', 'tax']);
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

  it('derives purchase and coupon for a government bond with no tax entry', () => {
    const holding: Holding = {
      id: 'gov',
      type: 'bond',
      currency: 'USD',
      balanceMinorUnits: 1_000_000,
      metadata: {
        quantity: 10,
        faceValueMinorUnits: 100_000,
        couponPct: 5,
        couponFrequency: 'annually',
        bondKind: 'government',
        purchaseDate: T0,
        maturityDate: T0 + 3650 * DAY,
      },
    };
    const now = T0 + 100 * DAY;

    const entries = derivedEntries(holding, now);

    expect(entries).toEqual([
      {
        id: 'derived:gov:purchase:0',
        time: T0,
        amountMinorUnits: 1_000_000,
        label: 'Purchase',
        kind: 'purchase',
        derived: true,
      },
      {
        id: 'derived:gov:coupon:0',
        time: now,
        amountMinorUnits: 13_699,
        label: 'Coupon',
        kind: 'coupon',
        derived: true,
      },
    ]);
    expect(entries.some((e) => e.kind === 'tax')).toBe(false);
  });

  it('derives purchase, coupon and tax for a corporate bond', () => {
    const holding: Holding = {
      id: 'corp',
      type: 'bond',
      currency: 'USD',
      balanceMinorUnits: 1_000_000,
      metadata: {
        quantity: 10,
        faceValueMinorUnits: 100_000,
        couponPct: 5,
        couponFrequency: 'annually',
        bondKind: 'corporate',
        purchaseDate: T0,
        maturityDate: T0 + 3650 * DAY,
      },
    };
    const now = T0 + 100 * DAY;

    const entries = derivedEntries(holding, now);

    expect(entries).toEqual([
      {
        id: 'derived:corp:purchase:0',
        time: T0,
        amountMinorUnits: 1_000_000,
        label: 'Purchase',
        kind: 'purchase',
        derived: true,
      },
      {
        id: 'derived:corp:coupon:0',
        time: now,
        amountMinorUnits: 13_699,
        label: 'Coupon',
        kind: 'coupon',
        derived: true,
      },
      {
        id: 'derived:corp:tax:0',
        time: now,
        amountMinorUnits: -3_150,
        label: 'Tax',
        kind: 'tax',
        derived: true,
      },
    ]);
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
