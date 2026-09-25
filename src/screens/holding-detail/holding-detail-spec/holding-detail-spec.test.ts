import type { HoldingRow } from '@kiko/db/schema';
import { startOfLocalDay } from '@kiko/dates/local-day';
import { EMPTY_PRICE_BOOK } from '@kiko/prices/price-book';
import { loanInstallments } from '@kiko/holdings/loan-schedule';
import type { BondMeta, LoanMeta } from '@kiko/holdings/holding-metadata';
import { holdingTypes, type HoldingType } from '@kiko/holdings/holding-type';
import { bondExpectedProfitMinor } from '@kiko/holdings/holding-descriptor/bond';

import {
  type FooterAction,
  holdingDetailSpecFor,
  holdingDetailSpecOrUndefined,
  holdingDetailSpecs,
} from './holding-detail-spec';

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

describe('holdingDetailSpecs breakdown', () => {
  it('shows the deposit its principal label with no expected-profit line', () => {
    const spec = holdingDetailSpecFor('term_deposit').breakdown;

    expect(spec?.principalLabelKey).toBe('holdingDetail.principal');
    expect(spec?.expectedProfit(holding({ type: 'term_deposit' }))).toBeNull();
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
    const spec = holdingDetailSpecs.bond.breakdown;

    expect(spec?.principalLabelKey).toBe('holdingDetail.cost');
    expect(spec?.expectedProfit(bondHolding)?.minorUnits).toBe(
      bondExpectedProfitMinor(meta, 'UAH'),
    );
  });

  it('returns null for a bond with unparsable metadata', () => {
    const spec = holdingDetailSpecs.bond.breakdown;

    expect(spec?.expectedProfit(holding({ type: 'bond', metadata: null }))).toBeNull();
  });

  it('hides the breakdown for every other type', () => {
    const noBreakdownTypes: readonly HoldingType[] = [
      'property_item',
      'metal',
      'loan',
      'card',
      'cash',
      'crypto_asset',
      'jar',
    ];

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
    const now = new Date();
    const startDate = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1);
    const meta: LoanMeta = {
      kind: 'car_loan',
      principalMinorUnits: 100_000_00,
      startDate,
      schedule: 'annuity',
      annualRatePct: 12,
      termMonths: 120,
    };
    const loanHolding = holding({ type: 'loan', metadata: meta });
    const todayStart = startOfLocalDay(Date.now());
    const expected = loanInstallments(meta).find((row) => row.dueDate >= todayStart);

    const next = holdingDetailSpecs.loan.nextInstallment(loanHolding, EMPTY_PRICE_BOOK, Date.now());

    expect(next).toEqual(expected);
  });
});

describe('holdingDetailSpecOrUndefined', () => {
  it('returns undefined for a type the registry does not know', () => {
    expect(holdingDetailSpecOrUndefined('not-a-real-type' as HoldingType)).toBeUndefined();
  });

  it("returns undefined for an inherited Object.prototype key, not that key's value", () => {
    expect(holdingDetailSpecOrUndefined('constructor' as HoldingType)).toBeUndefined();
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
});
