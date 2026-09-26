import type { HoldingRow } from '@kiko/db/schema';
import { addMonths } from '@kiko/holdings/interest';
import type { BondMeta, LoanMeta } from '@kiko/holdings/holding-metadata';
import { buildPriceBook, EMPTY_PRICE_BOOK } from '@kiko/prices/price-book';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';
import { holdingTypes, type HoldingType } from '@kiko/holdings/holding-type';
import { bondExpectedProfitMinor } from '@kiko/holdings/holding-descriptor/bond';

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
      expect(holdingDetailSpecs[type].footerAction(false)).toBe(unsynced);
      expect(holdingDetailSpecs[type].footerAction(true)).toBe(synced);
    },
  );
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
    expect(spec.expectedProfit(holding({ type: 'term_deposit' }))).toBeNull();
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
    expect(spec.expectedProfit(bondHolding)?.minorUnits).toBe(bondExpectedProfitMinor(meta, 'UAH'));
  });

  it('returns null for a bond with unparsable metadata', () => {
    const spec = asInterestBreakdown(holdingDetailSpecs.bond.breakdown);

    expect(spec.expectedProfit(holding({ type: 'bond', metadata: null }))).toBeNull();
  });

  // property_item and metal show the cost/value/gain breakdown instead of the
  // deposit/bond interest/tax table (they accrue no interest and withhold no
  // tax, so those rows would only ever read a misleading zero).
  it('shows property_item and metal the priced breakdown', () => {
    expect(holdingDetailSpecs.property_item.breakdown).toEqual({ kind: 'priced' });
    expect(holdingDetailSpecs.metal.breakdown).toEqual({ kind: 'priced' });
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

describe('holdingDetailSpecs nextInstallment', () => {
  it('returns undefined for every non-loan type', () => {
    for (const type of holdingTypes) {
      if (type === 'loan') {
        continue;
      }

      expect(
        holdingDetailSpecs[type].nextInstallment(holding({ type }), EMPTY_PRICE_BOOK, Date.now()),
      ).toBeUndefined();
    }
  });

  it('returns undefined for a "none" schedule loan (its outstanding is a manual series, not a computed schedule)', () => {
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
      holdingDetailSpecs.loan.nextInstallment(loanHolding, EMPTY_PRICE_BOOK, Date.now()),
    ).toBeUndefined();
  });

  it('returns the first installment due on/after today for a structured loan', () => {
    // Deriving `expectedDueDate` straight from `addMonths` — not from
    // `loanInstallments(meta).find(...)`, the SUT's own search — means a bug
    // in that search's predicate would still be caught here.
    const now = Date.UTC(2025, 6, 15);
    const startDate = Date.UTC(2024, 6, 1);
    const meta: LoanMeta = {
      kind: 'car_loan',
      principalMinorUnits: 100_000_00,
      startDate,
      schedule: 'annuity',
      annualRatePct: 12,
      termMonths: 120,
    };
    const loanHolding = holding({ type: 'loan', metadata: meta });
    // Installment 12 falls due 2025-07-01, before `now` (2025-07-15); installment
    // 13 falls due 2025-08-01, the first still on/after `now` — hence index 13.
    const expectedDueDate = addMonths(startDate, 13);

    const next = holdingDetailSpecs.loan.nextInstallment(loanHolding, EMPTY_PRICE_BOOK, now);

    expect(next).toBeDefined();
    expect(next?.index).toBe(13);
    expect(next?.dueDate).toBe(expectedDueDate);
  });

  // The same outstanding every other screen shows: linked payments that
  // repaid the whole loan hide the next payment too.
  it('returns undefined once the linked payments have repaid the loan', () => {
    const now = Date.UTC(2025, 6, 15);
    const meta: LoanMeta = {
      kind: 'car_loan',
      principalMinorUnits: 100_000_00,
      startDate: Date.UTC(2024, 6, 1),
      schedule: 'annuity',
      annualRatePct: 12,
      termMonths: 120,
    };
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
      holdingDetailSpecs.loan.nextInstallment(holding({ type: 'loan', metadata: meta }), book, now),
    ).toBeUndefined();
  });
});

describe('holdingDetailSpecFor', () => {
  it('returns the real spec for a known type', () => {
    expect(holdingDetailSpecFor('metal').footerAction(false)).toBe('addLot');
  });

  it('falls back to the balance spec for a type the registry does not know', () => {
    expect(holdingDetailSpecFor('not-a-real-type').footerAction(false)).toBe('transaction');
  });

  it('falls back to the balance spec for an undefined type', () => {
    expect(holdingDetailSpecFor(undefined).footerAction(false)).toBe('transaction');
  });

  it("falls back to the balance spec for an inherited Object.prototype key, not that key's value", () => {
    expect(holdingDetailSpecFor('constructor').footerAction(false)).toBe('transaction');
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

    if (ledgerless) {
      expect(spec.footerAction(false)).not.toBe('transaction');
      expect(spec.footerAction(true)).not.toBe('transaction');
    } else {
      expect(spec.footerAction(false)).toBe('transaction');
    }
  });
});
