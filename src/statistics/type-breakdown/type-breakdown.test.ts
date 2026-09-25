import type { HoldingRow } from '../../db/schema';
import type { RateTable } from '../../rates/conversion';
import { buildPriceBook } from '../../prices/price-book';
import { holdingInstrument } from '../../prices/instrument';

import { type BreakdownHolding, buildTypeBreakdown, type TypeSlice } from './type-breakdown';

const holding = (over: Partial<HoldingRow> & Pick<HoldingRow, 'type'>): BreakdownHolding => ({
  id: 'h1',
  currency: 'USD',
  balanceMinorUnits: 0,
  metadata: null,
  ...over,
});

// 1 UAH = 0.025 USD (so 40 UAH = 1 USD). BTC has no rate: crypto is unconvertible.
const rates: RateTable = { 'UAH:USD': 0.025 };

describe('buildTypeBreakdown', () => {
  it('sums each type across accounts and currencies, converted to base', () => {
    const holdings = [
      holding({ type: 'card', currency: 'USD', balanceMinorUnits: 10_000 }), // $100.00
      holding({ type: 'card', currency: 'UAH', balanceMinorUnits: 400_000 }), // 4000.00 UAH -> $100.00
      holding({ type: 'cash', currency: 'UAH', balanceMinorUnits: 40_000 }), // 400.00 UAH -> $10.00
    ];

    const result = buildTypeBreakdown({
      holdings,
      rateTable: rates,
      baseCurrency: 'USD',
      now: 0,
    });

    expect(result).toEqual([
      { type: 'card', amount: 20_000 },
      { type: 'cash', amount: 1_000 },
    ]);
  });

  it('skips an unconvertible holding without dropping its whole type', () => {
    const holdings = [
      holding({ type: 'card', currency: 'USD', balanceMinorUnits: 10_000 }),
      holding({ type: 'card', currency: 'BTC', balanceMinorUnits: 100_000_000 }), // 1 BTC, no rate
    ];

    const result = buildTypeBreakdown({
      holdings,
      rateTable: rates,
      baseCurrency: 'USD',
      now: 0,
    });

    expect(result).toEqual([{ type: 'card', amount: 10_000 }]);
  });

  it('excludes a type whose total is zero (including all-unconvertible types)', () => {
    const holdings = [
      holding({ type: 'card', currency: 'USD', balanceMinorUnits: 10_000 }),
      holding({ type: 'cash', currency: 'USD', balanceMinorUnits: 0 }), // zero balance
      holding({ type: 'crypto_asset', currency: 'BTC', balanceMinorUnits: 5_000 }), // no rate
    ];

    const result = buildTypeBreakdown({
      holdings,
      rateTable: rates,
      baseCurrency: 'USD',
      now: 0,
    });

    expect(result.map((slice) => slice.type)).toEqual(['card']);
  });

  it('sorts the slices by amount descending', () => {
    const holdings = [
      holding({ type: 'cash', currency: 'USD', balanceMinorUnits: 5_000 }),
      holding({ type: 'card', currency: 'USD', balanceMinorUnits: 30_000 }),
      holding({ type: 'jar', currency: 'USD', balanceMinorUnits: 12_000 }),
    ];

    const result: TypeSlice[] = buildTypeBreakdown({
      holdings,
      rateTable: rates,
      baseCurrency: 'USD',
      now: 0,
    });

    expect(result.map((slice) => slice.amount)).toEqual([30_000, 12_000, 5_000]);
    expect(result.map((slice) => slice.type)).toEqual(['card', 'jar', 'cash']);
  });

  // Threading a `PriceBook` through reaches a priced (property_item)
  // holding's value; with no book it falls back to its lots cost basis.
  it('values a property_item holding via the PriceBook, falling back to cost basis with no book', () => {
    const holdings = [
      holding({
        id: 'prop',
        type: 'property_item',
        currency: 'USD',
        metadata: {
          category: 'real_estate',
          lots: [{ day: 0, quantityDelta: '1', costMinorUnits: 20_000 }],
        },
      }),
    ];

    const noBook = buildTypeBreakdown({ holdings, rateTable: rates, baseCurrency: 'USD', now: 0 });
    expect(noBook).toEqual([{ type: 'property_item', amount: 20_000 }]);

    const book = buildPriceBook([
      {
        instrument: holdingInstrument('prop'),
        day: 0,
        price: '250',
        currency: 'USD',
        source: 'manual',
      },
    ]);
    const withBook = buildTypeBreakdown({
      holdings,
      rateTable: rates,
      baseCurrency: 'USD',
      now: 0,
      book,
    });
    expect(withBook).toEqual([{ type: 'property_item', amount: 25_000 }]);
  });

  // Debt is out of scope for the by-type ASSET bar (it has its own
  // "Debts" total elsewhere on Statistics — `buildDebtTotal`), and a loan's
  // held value is negative (`holding-value.ts`), which would otherwise
  // slip past the `amount !== 0` filter above as a negative bar.
  it('excludes a loan holding entirely — no loan bar, even though its value is negative', () => {
    const holdings = [
      holding({ type: 'card', currency: 'USD', balanceMinorUnits: 10_000 }),
      holding({
        id: 'loan-1',
        type: 'loan',
        currency: 'USD',
        metadata: {
          kind: 'personal',
          principalMinorUnits: 5_000,
          startDate: 0,
          annualRatePct: 10,
          termMonths: 12,
          schedule: 'annuity',
        },
      }),
    ];

    // Queried AT the loan's own startDate: outstanding is the full principal, so
    // the loan's own held value is a genuinely non-zero negative amount — a loose
    // `amount !== 0` filter alone would let it through as a negative bar.
    const result = buildTypeBreakdown({ holdings, rateTable: rates, baseCurrency: 'USD', now: 0 });

    expect(result.map((slice) => slice.type)).toEqual(['card']);
  });

  // The bar is an ASSET breakdown (same rule the account-contribution pie
  // follows) — a NON-loan holding in
  // debit (e.g. a credit card balance) must not draw a negative bar either,
  // not just `loan` (already covered above).
  it('excludes a non-loan negative holding (e.g. a card in debit) from the bar entirely', () => {
    const holdings = [
      holding({ type: 'card', currency: 'USD', balanceMinorUnits: -3_000 }),
      holding({ type: 'cash', currency: 'USD', balanceMinorUnits: 10_000 }),
    ];

    const result = buildTypeBreakdown({ holdings, rateTable: rates, baseCurrency: 'USD', now: 0 });

    expect(result.map((slice) => slice.type)).toEqual(['cash']);
  });

  // A negative holding must never NET against a positive one of the same
  // type — it must be dropped entirely, same as the account pie's own
  // per-holding rule. A card in debit sharing a type with a positive card
  // used to reduce the bar's total instead of being excluded from it, so
  // the same amount was silently subtracted here AND listed again under
  // "Debts" elsewhere on Statistics.
  it('never nets a negative holding against a positive one of the same type', () => {
    const holdings = [
      holding({ id: 'card-a', type: 'card', currency: 'USD', balanceMinorUnits: 10_000 }),
      holding({ id: 'card-b', type: 'card', currency: 'USD', balanceMinorUnits: -3_000 }),
    ];

    const result = buildTypeBreakdown({ holdings, rateTable: rates, baseCurrency: 'USD', now: 0 });

    expect(result).toEqual([{ type: 'card', amount: 10_000 }]);
  });
});
