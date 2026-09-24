import { buildPriceBook } from '../../prices/price-book';
import { holdingInstrument } from '../../prices/instrument';
import type { AccountRow, HoldingRow } from '../../db/schema';
import { defaultAccountColor } from '../../holdings/entity-colors';

import {
  buildAccountContribution,
  buildDebtTotal,
  type ContributionAccount,
  type ContributionHolding,
} from './account-contribution';

const NOW = Date.UTC(2026, 0, 1);
const HEX = /^#[0-9a-f]{6}$/i;

const account = (
  id: string,
  name: string,
  over: Partial<Pick<AccountRow, 'kind' | 'color'>> = {},
): ContributionAccount => ({ id, name, kind: 'bank', color: null, ...over });

const holding = (
  over: Partial<HoldingRow> & Pick<HoldingRow, 'accountId'>,
): ContributionHolding => ({
  currency: 'UAH',
  type: 'cash',
  balanceMinorUnits: 0,
  metadata: null,
  ...over,
});

describe('buildAccountContribution', () => {
  it('converts each account to the base currency and derives shares that sum to 1', () => {
    const accounts = [account('a', 'Cash'), account('b', 'Dollars'), account('c', 'Euros')];
    const holdings = [
      holding({ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 }), // 100_000
      holding({ accountId: 'b', currency: 'USD', balanceMinorUnits: 10_000 }), // 100 * 40 = 400_000
      holding({ accountId: 'c', currency: 'EUR', balanceMinorUnits: 20_000 }), // 200 * 45 = 900_000
    ];
    const rateTable = { 'USD:UAH': 40, 'EUR:UAH': 45 };

    const slices = buildAccountContribution({
      accounts,
      holdings,
      rateTable,
      baseCurrency: 'UAH',
      now: NOW,
    });

    // Returned largest-first (see the dedicated ordering test below), so the
    // input a/b/c comes back c/b/a by amount.
    expect(slices.map((slice) => slice.accountId)).toEqual(['c', 'b', 'a']);
    expect(slices.map((slice) => slice.amount)).toEqual([900_000, 400_000, 100_000]);

    const total = 1_400_000;
    expect(slices[0].share).toBeCloseTo(900_000 / total, 6);
    expect(slices[1].share).toBeCloseTo(400_000 / total, 6);
    expect(slices[2].share).toBeCloseTo(100_000 / total, 6);
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1, 6);
  });

  it('orders the slices largest-first (descending by amount)', () => {
    // The accounts arrive smallest-first; the pie must return them largest-first
    // so the biggest contributor leads the ring and the legend.
    const accounts = [account('a', 'Small'), account('b', 'Medium'), account('c', 'Large')];
    const holdings = [
      holding({ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 }),
      holding({ accountId: 'b', currency: 'UAH', balanceMinorUnits: 400_000 }),
      holding({ accountId: 'c', currency: 'UAH', balanceMinorUnits: 900_000 }),
    ];

    const slices = buildAccountContribution({
      accounts,
      holdings,
      rateTable: {},
      baseCurrency: 'UAH',
      now: NOW,
    });

    expect(slices.map((slice) => slice.accountId)).toEqual(['c', 'b', 'a']);
    expect(slices.map((slice) => slice.amount)).toEqual([900_000, 400_000, 100_000]);
  });

  it('excludes an account whose only holding cannot convert (no rate)', () => {
    const accounts = [account('a', 'Cash'), account('b', 'Euros')];
    const holdings = [
      holding({ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 }),
      holding({ accountId: 'b', currency: 'EUR', balanceMinorUnits: 20_000 }), // no EUR:UAH rate
    ];

    const slices = buildAccountContribution({
      accounts,
      holdings,
      rateTable: { 'USD:UAH': 40 },
      baseCurrency: 'UAH',
      now: NOW,
    });

    expect(slices.map((slice) => slice.accountId)).toEqual(['a']);
    expect(slices[0].share).toBe(1);
  });

  it("resolves each slice's color to the account's own color, else the kind default", () => {
    const accounts = [
      account('a', 'Cash', { kind: 'cash', color: null }),
      account('b', 'Custom', { kind: 'bank', color: '#123456' }),
    ];
    const holdings = [
      holding({ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 }),
      holding({ accountId: 'b', currency: 'UAH', balanceMinorUnits: 100_000 }),
    ];

    const slices = buildAccountContribution({
      accounts,
      holdings,
      rateTable: {},
      baseCurrency: 'UAH',
      now: NOW,
    });

    expect(slices.find((slice) => slice.accountId === 'a')?.color).toBe(defaultAccountColor.cash);
    expect(slices.find((slice) => slice.accountId === 'b')?.color).toBe('#123456');
  });

  it('resolves a stored empty-string color to a real hex', () => {
    const slices = buildAccountContribution({
      accounts: [account('a', 'X', { kind: 'cash', color: '' })],
      holdings: [holding({ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_00 })],
      rateTable: {},
      baseCurrency: 'UAH',
      now: NOW,
    });

    expect(slices[0].color).toMatch(HEX);
  });

  it('resolves an unmapped kind to a real hex, never undefined', () => {
    const slices = buildAccountContribution({
      // `broker` was a valid Account.kind once and was dropped; the schema enum
      // is TS-only with no CHECK constraint, so such a row can still exist.
      accounts: [account('a', 'X', { kind: 'broker' as AccountRow['kind'], color: null })],
      holdings: [holding({ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_00 })],
      rateTable: {},
      baseCurrency: 'UAH',
      now: NOW,
    });

    expect(slices[0].color).toMatch(HEX);
  });

  it('still prefers a valid stored color', () => {
    const slices = buildAccountContribution({
      accounts: [account('a', 'X', { kind: 'cash', color: '#123456' })],
      holdings: [holding({ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_00 })],
      rateTable: {},
      baseCurrency: 'UAH',
      now: NOW,
    });

    expect(slices[0].color).toBe('#123456');
  });

  it('filters out an account with zero net worth', () => {
    const accounts = [account('a', 'Cash'), account('z', 'Empty')];
    const holdings = [
      holding({ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 }),
      holding({ accountId: 'z', currency: 'UAH', balanceMinorUnits: 0 }),
    ];

    const slices = buildAccountContribution({
      accounts,
      holdings,
      rateTable: {},
      baseCurrency: 'UAH',
      now: NOW,
    });

    expect(slices.map((slice) => slice.accountId)).toEqual(['a']);
  });

  // T27: a debt account's net worth is a loan's negative held value
  // (`holding-value.ts`) — it must never surface as a pie slice (a negative
  // share would break the ring), same as the existing zero-net-worth filter.
  it('excludes a debt account (negative net worth) from the pie — never a negative slice', () => {
    const accounts = [account('a', 'Cash'), account('d', 'Mortgage', { kind: 'debt' })];
    const holdings = [
      holding({ accountId: 'a', currency: 'UAH', balanceMinorUnits: 100_000 }),
      holding({
        id: 'loan-1',
        accountId: 'd',
        type: 'loan',
        currency: 'UAH',
        metadata: {
          kind: 'mortgage',
          principalMinorUnits: 500_000,
          startDate: NOW,
          annualRatePct: 10,
          termMonths: 12,
          schedule: 'annuity',
        },
      }),
    ];

    const slices = buildAccountContribution({
      accounts,
      holdings,
      rateTable: {},
      baseCurrency: 'UAH',
      now: NOW,
    });

    expect(slices.map((slice) => slice.accountId)).toEqual(['a']);
    expect(slices.every((slice) => slice.amount > 0)).toBe(true);
  });

  // I2 (T27 round 1, spec §5.2/§5.3): the account pie is ASSETS ONLY — a
  // slice sums only its POSITIVE holding values; a negative holding (a
  // credit-card debit balance, spec §5.2) never reduces it. An account whose
  // only holding is negative therefore has nothing positive to show at all.
  it('excludes an account whose only holding is a negative (credit-card debt) balance from the pie', () => {
    const accounts = [account('a', 'Card')];
    const holdings = [
      holding({ accountId: 'a', type: 'card', currency: 'UAH', balanceMinorUnits: -300_000 }),
    ];

    const slices = buildAccountContribution({
      accounts,
      holdings,
      rateTable: {},
      baseCurrency: 'UAH',
      now: NOW,
    });

    expect(slices).toEqual([]);
  });

  it('sums ONLY the positive holding values of an account — a negative holding never nets against a positive one', () => {
    const accounts = [account('a', 'Mixed')];
    const holdings = [
      holding({ accountId: 'a', type: 'cash', currency: 'UAH', balanceMinorUnits: 500_000 }),
      holding({ accountId: 'a', type: 'card', currency: 'UAH', balanceMinorUnits: -300_000 }),
    ];

    const slices = buildAccountContribution({
      accounts,
      holdings,
      rateTable: {},
      baseCurrency: 'UAH',
      now: NOW,
    });

    // Not 500_000 - 300_000 = 200_000 (a net); the positive cash holding
    // alone, unreduced by the negative card holding.
    expect(slices).toEqual([
      { accountId: 'a', name: 'Mixed', amount: 500_000, share: 1, color: expect.any(String) },
    ]);
  });

  // T14: threading a `PriceBook` through reaches a priced (property_item)
  // holding's value; with no book it falls back to its lots cost basis.
  it('values a property_item holding via the PriceBook, falling back to cost basis with no book', () => {
    const accounts = [account('a', 'Property')];
    const holdings = [
      holding({
        id: 'prop',
        accountId: 'a',
        type: 'property_item',
        currency: 'UAH',
        metadata: {
          category: 'real_estate',
          lots: [{ day: NOW, quantityDelta: '1', costMinorUnits: 500_000 }],
        },
      }),
    ];

    const noBook = buildAccountContribution({
      accounts,
      holdings,
      rateTable: {},
      baseCurrency: 'UAH',
      now: NOW,
    });
    expect(noBook[0].amount).toBe(500_000);

    const book = buildPriceBook([
      {
        instrument: holdingInstrument('prop'),
        day: NOW,
        price: '7000',
        currency: 'UAH',
        source: 'manual',
      },
    ]);
    const withBook = buildAccountContribution({
      accounts,
      holdings,
      rateTable: {},
      baseCurrency: 'UAH',
      now: NOW,
      book,
    });
    expect(withBook[0].amount).toBe(700_000);
  });
});

describe('buildDebtTotal', () => {
  it('sums every loan holding across accounts, converted to base, as a NEGATIVE total', () => {
    const holdings = [
      holding({
        id: 'loan-1',
        accountId: 'd',
        type: 'loan',
        currency: 'UAH',
        metadata: {
          kind: 'mortgage',
          principalMinorUnits: 500_000,
          startDate: NOW,
          annualRatePct: 10,
          termMonths: 12,
          schedule: 'annuity',
        },
      }),
      holding({
        id: 'loan-2',
        accountId: 'e',
        type: 'loan',
        currency: 'USD',
        metadata: {
          kind: 'personal',
          principalMinorUnits: 10_000,
          startDate: NOW,
          annualRatePct: 5,
          termMonths: 6,
          schedule: 'annuity',
        },
      }),
    ];

    // Queried at each loan's own startDate: outstanding is the full principal,
    // so each loan's own held value is exactly `-principal`.
    const total = buildDebtTotal({
      holdings,
      rateTable: { 'USD:UAH': 40 },
      baseCurrency: 'UAH',
      now: NOW,
    });

    expect(total.currency).toBe('UAH');
    expect(total.minorUnits).toBe(-500_000 - 10_000 * 40);
  });

  it('ignores a POSITIVE non-loan holding entirely — only a negative balance counts as debt', () => {
    const holdings = [
      holding({ accountId: 'a', type: 'cash', currency: 'UAH', balanceMinorUnits: 100_000 }),
    ];

    const total = buildDebtTotal({ holdings, rateTable: {}, baseCurrency: 'UAH', now: NOW });

    expect(total.minorUnits).toBe(0);
  });

  // I2 (T27 round 1, spec §5.2): "Credit-card negative balances count as
  // debt too." A negative non-loan holding balance (a card in debit) is not
  // a `loan` holding, but its own value is negative all the same, so it
  // counts toward the Debts total exactly like a loan's negative outstanding.
  it('counts a negative non-loan holding balance (credit-card debt) toward the Debts total', () => {
    const holdings = [
      holding({ accountId: 'a', type: 'card', currency: 'UAH', balanceMinorUnits: -300_000 }),
    ];

    const total = buildDebtTotal({ holdings, rateTable: {}, baseCurrency: 'UAH', now: NOW });

    expect(total.minorUnits).toBe(-300_000);
  });

  it('sums a loan and a negative non-loan balance together, converted to base', () => {
    const holdings = [
      holding({
        id: 'loan-1',
        accountId: 'd',
        type: 'loan',
        currency: 'UAH',
        metadata: {
          kind: 'mortgage',
          principalMinorUnits: 500_000,
          startDate: NOW,
          annualRatePct: 10,
          termMonths: 12,
          schedule: 'annuity',
        },
      }),
      holding({ accountId: 'a', type: 'card', currency: 'UAH', balanceMinorUnits: -300_000 }),
    ];

    const total = buildDebtTotal({ holdings, rateTable: {}, baseCurrency: 'UAH', now: NOW });

    expect(total.minorUnits).toBe(-500_000 - 300_000);
  });

  it('is 0 when there are no loan holdings at all', () => {
    const total = buildDebtTotal({ holdings: [], rateTable: {}, baseCurrency: 'UAH', now: NOW });

    expect(total.minorUnits).toBe(0);
  });

  it('excludes an unconvertible loan holding rather than throwing', () => {
    const holdings = [
      holding({
        id: 'loan-1',
        accountId: 'd',
        type: 'loan',
        currency: 'EUR', // no EUR:UAH rate
        metadata: {
          kind: 'mortgage',
          principalMinorUnits: 500_000,
          startDate: NOW,
          annualRatePct: 10,
          termMonths: 12,
          schedule: 'annuity',
        },
      }),
    ];

    const total = buildDebtTotal({ holdings, rateTable: {}, baseCurrency: 'UAH', now: NOW });

    expect(total.minorUnits).toBe(0);
  });
});
