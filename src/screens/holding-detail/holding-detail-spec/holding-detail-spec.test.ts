import {
  bondExpectedProfitMinor,
  isLedgerlessHoldingType,
} from '@kiko/holdings/holding-descriptor';
import type { HoldingRow } from '@kiko/db';
import { addMonths } from '@kiko/holdings/interest';
import type { BondTerms } from '@kiko/bonds/nbu-register';
import type { BondMeta, LoanMeta } from '@kiko/holdings/holding-metadata';
import { buildPriceBook, EMPTY_PRICE_BOOK } from '@kiko/prices/price-book';
import { holdingTypes, type HoldingType } from '@kiko/holdings/holding-type';

import { type FooterAction, holdingDetailSpecFor, holdingDetailSpecs } from './holding-detail-spec';

const holding = (overrides: Partial<HoldingRow> = {}): HoldingRow =>
  ({
    id: 'h1',
    accountId: 'a1',
    type: 'cash',
    name: 'x',
    currency: 'UAH',
    balanceMinorUnits: 0,
    icon: null,
    color: null,
    metadata: null,
    sortOrder: 0,
    ...overrides,
  }) as HoldingRow;

// The full footer-action table: `metal` gets `addLot` (its price comes from
// the shared instrument, so it never offers "Update value") while every
// other priced type keeps `updateValue`.
describe('holdingDetailSpecs footerAction', () => {
  const table: ReadonlyArray<{ type: HoldingType; unsynced: FooterAction; synced: FooterAction }> =
    [
      { type: 'term_deposit', unsynced: 'contribution', synced: 'contribution' },
      { type: 'bond', unsynced: 'none', synced: 'none' },
      { type: 'property_item', unsynced: 'updateValue', synced: 'updateValue' },
      { type: 'metal', unsynced: 'addLot', synced: 'addLot' },
      { type: 'loan', unsynced: 'updateValue', synced: 'updateValue' },
      { type: 'card', unsynced: 'transaction', synced: 'none' },
      { type: 'cash', unsynced: 'transaction', synced: 'none' },
      { type: 'crypto_asset', unsynced: 'transaction', synced: 'none' },
      { type: 'jar', unsynced: 'transaction', synced: 'none' },
    ];

  it.each(table)(
    '$type: unsynced -> $unsynced, synced -> $synced',
    ({ type, unsynced, synced }) => {
      expect(holdingDetailSpecs[type].footerAction(false, holding({ type }))).toBe(unsynced);
      expect(holdingDetailSpecs[type].footerAction(true, holding({ type }))).toBe(synced);
    },
  );

  // A manual share has no feed, so its footer also updates its price; an
  // EODHD share's price comes from the refresh, so it only adds lots.
  const shareHolding = (metadata: unknown) => holding({ type: 'share', metadata });
  const lots = [{ day: Date.UTC(2026, 0, 1), quantityDelta: '1', costMinorUnits: 100 }];

  it('offers a manual share both Add lot and Update price', () => {
    const manual = shareHolding({ quoteSource: 'manual', lots });

    expect(holdingDetailSpecs.share.footerAction(false, manual)).toBe('addLotAndUpdatePrice');
  });

  it('offers an EODHD share only Add lot', () => {
    const eodhd = shareHolding({ quoteSource: 'eodhd', symbol: 'AAPL.US', lots });

    expect(holdingDetailSpecs.share.footerAction(false, eodhd)).toBe('addLot');
  });

  it('offers a share with unreadable metadata only Add lot', () => {
    expect(holdingDetailSpecs.share.footerAction(false, shareHolding(null))).toBe('addLot');
  });
});

// Narrows a breakdown spec to its `interest` variant, or fails the test
// loudly — every case below expects one, so a wrongly-shaped spec should
// never silently read `undefined` off a mismatched property access.
const asInterestBreakdown = (
  spec: ReturnType<typeof holdingDetailSpecFor>['breakdown'],
): Extract<NonNullable<typeof spec>, { kind: 'interest' }> => {
  if (spec?.kind !== 'interest') {
    throw new Error('expected an interest breakdown spec');
  }

  return spec;
};

describe('holdingDetailSpecs breakdown', () => {
  it('shows the deposit its principal label with no expected-profit line', () => {
    const spec = asInterestBreakdown(holdingDetailSpecFor('term_deposit').breakdown);

    expect(spec.principalLabelKey).toBe('holdingDetail.principal');
    expect(spec.expectedProfit(holding({ type: 'term_deposit' }), null)).toBeNull();
  });

  it("shows a bond its cost label with the bond's whole-life expected profit", () => {
    const meta: BondMeta = {
      quantity: 10,
      faceValueMinorUnits: 100_000,
      couponPct: 5,
      couponFrequency: 'annually',
      bondKind: 'government',
      purchaseDate: Date.UTC(2024, 0, 1),
      purchasePriceMinorUnits: 950_000,
      maturityDate: Date.UTC(2027, 0, 1),
    };
    const bondHolding = holding({ type: 'bond', currency: 'UAH', metadata: meta });
    const spec = asInterestBreakdown(holdingDetailSpecs.bond.breakdown);

    expect(spec.principalLabelKey).toBe('holdingDetail.cost');
    expect(spec.expectedProfit(bondHolding, null)?.minorUnits).toBe(
      bondExpectedProfitMinor(meta, 'UAH', []),
    );
  });

  describe('a step-up ISIN bond', () => {
    // 1,000 x XS2895055981 (1-dollar nominal) for 980.00, saved at 4.5%: one
    // 22.50 coupon before the step, four 30.00 after, then 1,000.00 redeemed.
    const stepUpMeta: BondMeta = {
      quantity: 1000,
      faceValueMinorUnits: 100,
      couponPct: 4.5,
      couponFrequency: 'semiannually',
      bondKind: 'government',
      purchaseDate: new Date(2026, 8, 26).getTime(),
      purchasePriceMinorUnits: 98_000,
      maturityDate: new Date(2029, 1, 1).getTime(),
      isin: 'XS2895055981',
    };
    const stepUpTerms: BondTerms = {
      isin: 'XS2895055981',
      currency: 'USD',
      faceValueMinorUnits: 100,
      couponPct: 4.5,
      maturityDate: new Date(2029, 1, 1).getTime(),
      couponFrequency: 'semiannually',
      name: 'OЗДП-середньострокова XS2895055981',
      payments: [
        { date: new Date(2027, 1, 1).getTime(), kind: 'coupon', amount: '0.0225' },
        { date: new Date(2027, 7, 1).getTime(), kind: 'coupon', amount: '0.03' },
        { date: new Date(2028, 1, 1).getTime(), kind: 'coupon', amount: '0.03' },
        { date: new Date(2028, 7, 1).getTime(), kind: 'coupon', amount: '0.03' },
        { date: new Date(2029, 1, 1).getTime(), kind: 'coupon', amount: '0.03' },
        { date: new Date(2029, 1, 1).getTime(), kind: 'redemption', amount: '1' },
      ],
    };
    const stepUpHolding = holding({ type: 'bond', currency: 'USD', metadata: stepUpMeta });
    const spec = asInterestBreakdown(holdingDetailSpecs.bond.breakdown);

    it("sums the expected profit from each register coupon's own rate", () => {
      expect(spec.expectedProfit(stepUpHolding, stepUpTerms)?.minorUnits).toBe(16_250);
    });

    it('falls back to the saved coupon when the cache has no payments for it', () => {
      const olderCache = { ...stepUpTerms, payments: undefined };

      expect(spec.expectedProfit(stepUpHolding, olderCache)?.minorUnits).toBe(13_250);
      expect(spec.expectedProfit(stepUpHolding, null)?.minorUnits).toBe(13_250);
    });

    it('keeps the register profit from its kept schedule once its ISIN has left the cache', () => {
      const kept = holding({
        type: 'bond',
        currency: 'USD',
        metadata: { ...stepUpMeta, payments: stepUpTerms.payments },
      });

      expect(spec.expectedProfit(kept, null)?.minorUnits).toBe(16_250);
    });
  });

  it('returns null for a bond with unparsable metadata', () => {
    const spec = asInterestBreakdown(holdingDetailSpecs.bond.breakdown);

    expect(spec.expectedProfit(holding({ type: 'bond', metadata: null }), null)).toBeNull();
    expect(spec.yieldToMaturity(holding({ type: 'bond', metadata: null }), null)).toBeNull();
  });

  it("shows a bond its yield to maturity from the bond's own price and schedule", () => {
    const meta: BondMeta = {
      quantity: 98,
      faceValueMinorUnits: 100_000,
      couponPct: 15.18,
      couponFrequency: 'semiannually',
      bondKind: 'government',
      purchaseDate: new Date(2026, 8, 10).getTime(),
      purchasePriceMinorUnits: 10_551_856,
      maturityDate: new Date(2027, 8, 15).getTime(),
    };
    const bondHolding = holding({ type: 'bond', currency: 'UAH', metadata: meta });
    const spec = asInterestBreakdown(holdingDetailSpecs.bond.breakdown);

    expect(spec.yieldToMaturity(bondHolding, null)?.toFixed(4)).toBe('0.1540');
  });

  it('shows a bond saved without a price its nominal-default expected profit but no yield', () => {
    const meta = {
      quantity: 98,
      faceValueMinorUnits: 100_000,
      couponPct: 15.18,
      couponFrequency: 'semiannually' as const,
      bondKind: 'government' as const,
      purchaseDate: new Date(2026, 8, 10).getTime(),
      maturityDate: new Date(2027, 8, 15).getTime(),
    };
    const bondHolding = holding({ type: 'bond', currency: 'UAH', metadata: meta });
    const spec = asInterestBreakdown(holdingDetailSpecs.bond.breakdown);

    expect(spec.expectedProfit(bondHolding, null)?.minorUnits).toBe(
      bondExpectedProfitMinor({ ...meta, purchasePriceMinorUnits: 9_800_000 }, 'UAH', []),
    );
    expect(spec.yieldToMaturity(bondHolding, null)).toBeNull();
  });

  it('shows a deposit no yield to maturity', () => {
    const spec = asInterestBreakdown(holdingDetailSpecFor('term_deposit').breakdown);

    expect(spec.yieldToMaturity(holding({ type: 'term_deposit' }), null)).toBeNull();
  });

  // property_item and metal show the cost/value/gain breakdown instead of the
  // deposit/bond interest/tax table (they accrue no interest and withhold no
  // tax, so those rows would only ever read a misleading zero).
  it('shows property_item, metal, and share the priced breakdown', () => {
    expect(holdingDetailSpecs.property_item.breakdown).toEqual({ kind: 'priced' });
    expect(holdingDetailSpecs.metal.breakdown).toEqual({ kind: 'priced' });
    expect(holdingDetailSpecs.share.breakdown).toEqual({ kind: 'priced' });
  });

  it('shows a loan the ledger breakdown', () => {
    expect(holdingDetailSpecs.loan.breakdown).toEqual({ kind: 'loan' });
  });

  it('hides the breakdown for every other type', () => {
    const noBreakdownTypes: readonly HoldingType[] = ['card', 'cash', 'crypto_asset', 'jar'];

    for (const type of noBreakdownTypes) {
      expect(holdingDetailSpecs[type].breakdown).toBeNull();
    }
  });
});

describe('holdingDetailSpecs upcomingInstallments', () => {
  const structuredMeta = (overrides: Partial<LoanMeta> = {}): LoanMeta => ({
    kind: 'car_loan',
    principalMinorUnits: 100_000_00,
    startDate: Date.UTC(2024, 6, 1),
    schedule: 'annuity',
    annualRatePct: 12,
    termMonths: 120,
    ...overrides,
  });

  it('returns no installment for every non-loan type', () => {
    for (const type of holdingTypes) {
      if (type === 'loan') {
        continue;
      }

      expect(
        holdingDetailSpecs[type].upcomingInstallments(
          holding({ type }),
          EMPTY_PRICE_BOOK,
          Date.now(),
        ),
      ).toEqual([]);
    }
  });

  it('returns no installment for a "none" schedule loan (its outstanding is a manual series, not a computed schedule)', () => {
    const loanHolding = holding({
      type: 'loan',
      metadata: {
        kind: 'personal',
        principalMinorUnits: 10_000_00,
        startDate: Date.UTC(2020, 0, 1),
        schedule: 'none',
      },
    });

    expect(
      holdingDetailSpecs.loan.upcomingInstallments(loanHolding, EMPTY_PRICE_BOOK, Date.now()),
    ).toEqual([]);
  });

  it.each(['annuity', 'differentiated'] as const)(
    'lists every remaining %s installment, starting at the first due on/after today',
    (schedule) => {
      // Deriving the due dates straight from `addMonths` — not from
      // `loanInstallments(meta).filter(...)`, the SUT's own search — means a
      // bug in that search's predicate would still be caught here.
      // Installment 12 falls due 2025-07-01, before `now` (2025-07-15);
      // installment 13 falls due 2025-08-01, the first still on/after `now`.
      const now = Date.UTC(2025, 6, 15);
      const meta = structuredMeta({ schedule });

      const upcoming = holdingDetailSpecs.loan.upcomingInstallments(
        holding({ type: 'loan', metadata: meta }),
        EMPTY_PRICE_BOOK,
        now,
      );

      expect(upcoming).toHaveLength(120 - 12);
      expect(upcoming[0].index).toBe(13);
      expect(upcoming[0].dueDate).toBe(addMonths(meta.startDate, 13));
      expect(upcoming.at(-1)?.index).toBe(120);
    },
  );

  it('lists all 360 installments of a 30-year mortgage that starts today', () => {
    const now = Date.UTC(2025, 6, 15);
    const meta = structuredMeta({ startDate: now, termMonths: 360 });

    expect(
      holdingDetailSpecs.loan.upcomingInstallments(
        holding({ type: 'loan', metadata: meta }),
        EMPTY_PRICE_BOOK,
        now,
      ),
    ).toHaveLength(360);
  });

  it('returns no installment once a correction clamps the outstanding to 0', () => {
    const now = Date.UTC(2025, 6, 15);
    const book = buildPriceBook([
      {
        instrument: 'holding:h1',
        day: Date.UTC(2025, 6, 1),
        price: '0.00',
        currency: 'UAH',
        source: 'manual',
      },
    ]);

    expect(
      holdingDetailSpecs.loan.upcomingInstallments(
        holding({ type: 'loan', metadata: structuredMeta() }),
        book,
        now,
      ),
    ).toEqual([]);
  });

  // The same outstanding every other screen shows: linked payments that
  // repaid the whole loan hide the upcoming payments too.
  it('returns no installment once the linked payments have repaid the loan', () => {
    const now = Date.UTC(2025, 6, 15);
    const meta = structuredMeta();
    const book = buildPriceBook(
      [],
      [
        {
          loanHoldingId: 'h1',
          time: Date.UTC(2025, 5, 1),
          amountMinorUnits: -200_000_00,
          currency: 'UAH',
        },
      ],
    );

    expect(
      holdingDetailSpecs.loan.upcomingInstallments(
        holding({ type: 'loan', metadata: meta }),
        book,
        now,
      ),
    ).toEqual([]);
  });
});

describe('holdingDetailSpecFor', () => {
  it('returns the real spec for a known type', () => {
    expect(holdingDetailSpecFor('metal').footerAction(false, holding())).toBe('addLot');
  });

  it('falls back to the balance spec for a type the registry does not know', () => {
    expect(holdingDetailSpecFor('not-a-real-type').footerAction(false, holding())).toBe(
      'transaction',
    );
  });

  it('falls back to the balance spec for an undefined type', () => {
    expect(holdingDetailSpecFor(undefined).footerAction(false, holding())).toBe('transaction');
  });

  it("falls back to the balance spec for an inherited Object.prototype key, not that key's value", () => {
    expect(holdingDetailSpecFor('constructor').footerAction(false, holding())).toBe('transaction');
  });
});

// Grounds holding-descriptors.ts's claim that this registry agrees with
// `isLedgerlessHoldingType` on which types write no manual ledger: a
// ledgerless type must never offer the plain "add transaction" footer
// action (synced or not), and every other type must offer it unsynced —
// the same gate `isTransactionEligibleType` (transaction-form.screen.tsx)
// re-derives from `isLedgerlessHoldingType` rather than importing this file.
describe('holdingDetailSpecs agreement with isLedgerlessHoldingType', () => {
  it.each(holdingTypes)('%s', (type) => {
    const ledgerless = isLedgerlessHoldingType(type);
    const spec = holdingDetailSpecs[type];
    const row = holding({ type });

    if (ledgerless) {
      expect(spec.footerAction(false, row)).not.toBe('transaction');
      expect(spec.footerAction(true, row)).not.toBe('transaction');
    } else {
      expect(spec.footerAction(false, row)).toBe('transaction');
    }
  });
});
