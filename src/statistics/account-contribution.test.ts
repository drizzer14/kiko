import type { AccountRow, HoldingRow } from '../db/schema';
import { defaultAccountColor } from '../holdings/entity-colors';

import {
  buildAccountContribution,
  type ContributionAccount,
  type ContributionHolding,
} from './account-contribution';

const NOW = Date.UTC(2026, 0, 1);

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

    expect(slices.map((slice) => slice.accountId)).toEqual(['a', 'b', 'c']);
    expect(slices.map((slice) => slice.amount)).toEqual([100_000, 400_000, 900_000]);

    const total = 1_400_000;
    expect(slices[0].share).toBeCloseTo(100_000 / total, 6);
    expect(slices[1].share).toBeCloseTo(400_000 / total, 6);
    expect(slices[2].share).toBeCloseTo(900_000 / total, 6);
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1, 6);
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
});
