import type { HoldingRow } from '../../db/schema';
import type { RateTable } from '../../rates/conversion';

import { type BreakdownHolding, buildTypeBreakdown, type TypeSlice } from './type-breakdown';

const holding = (over: Partial<HoldingRow> & Pick<HoldingRow, 'type'>): BreakdownHolding => ({
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
});
