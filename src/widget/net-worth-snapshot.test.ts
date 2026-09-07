import { guardedNetWorth } from '../rates/net-worth-view';

import { buildNetWorthSnapshot } from './net-worth-snapshot';

const accounts = [
  { id: 'a1', archivedAt: null },
  { id: 'a2', archivedAt: 1_700_000_000_000 },
];

const holding = (over: Partial<Record<string, unknown>>) => ({
  id: 'h',
  accountId: 'a1',
  name: 'H',
  type: 'cash',
  currency: 'USD',
  icon: null,
  color: null,
  balanceMinorUnits: 0,
  metadata: null,
  sortOrder: 0,
  closedAt: null,
  createdAt: 0,
  ...over,
});

const rateTable = { 'USD:UAH': 40, 'EUR:UAH': 44 };
const now = 1_700_000_100_000;

describe('buildNetWorthSnapshot', () => {
  it('matches guardedNetWorth for the total over the active holdings', () => {
    const holdings = [
      holding({ id: 'h1', currency: 'USD', balanceMinorUnits: 10_000 }), // active
      holding({ id: 'h2', currency: 'USD', balanceMinorUnits: 5_000, closedAt: 1 }), // closed
      holding({ id: 'h3', accountId: 'a2', currency: 'USD', balanceMinorUnits: 9_000 }), // archived parent
    ];
    const snapshot = buildNetWorthSnapshot({
      holdings,
      accounts,
      rateTable,
      baseCurrency: 'UAH',
      now,
    });
    const expected = guardedNetWorth(
      [holding({ id: 'h1', currency: 'USD', balanceMinorUnits: 10_000 })],
      'UAH',
      rateTable,
      now,
    );

    expect(snapshot.total.minorUnits).toBe(expected.minorUnits);
    expect(snapshot.baseCurrency).toBe('UAH');
  });

  it('produces a per-currency breakdown over the active holdings', () => {
    const holdings = [
      holding({ id: 'h1', currency: 'USD', balanceMinorUnits: 10_000 }),
      holding({ id: 'h2', currency: 'EUR', balanceMinorUnits: 20_000 }),
    ];
    const snapshot = buildNetWorthSnapshot({
      holdings,
      accounts,
      rateTable,
      baseCurrency: 'UAH',
      now,
    });

    expect(snapshot.breakdown).toEqual(
      expect.arrayContaining([
        { currency: 'USD', minorUnits: 10_000, formatted: '$100.00' },
        { currency: 'EUR', minorUnits: 20_000, formatted: '€200.00' },
      ]),
    );
  });

  it('formats each breakdown item with the same formatMoney the total uses', () => {
    const holdings = [holding({ id: 'h1', currency: 'UAH', balanceMinorUnits: 654_321 })];
    const snapshot = buildNetWorthSnapshot({
      holdings,
      accounts,
      rateTable,
      baseCurrency: 'UAH',
      now,
    });

    expect(snapshot.breakdown[0]?.formatted).toContain('6,543.21');
  });

  it('formats the total with formatMoney', () => {
    const holdings = [holding({ id: 'h1', currency: 'UAH', balanceMinorUnits: 123_456 })];
    const snapshot = buildNetWorthSnapshot({
      holdings,
      accounts,
      rateTable,
      baseCurrency: 'UAH',
      now,
    });

    expect(snapshot.total.formatted).toContain('1,234.56');
  });

  it('handles the empty / first-run case (no holdings)', () => {
    const snapshot = buildNetWorthSnapshot({
      holdings: [],
      accounts: [],
      rateTable: {},
      baseCurrency: 'UAH',
      now,
    });

    expect(snapshot.total.minorUnits).toBe(0);
    expect(snapshot.breakdown).toEqual([]);
    expect(snapshot.updatedAt).toBe(now);
  });

  it('does not carry a trend series — the widget renders only the total and the breakdown', () => {
    const snapshot = buildNetWorthSnapshot({
      holdings: [holding({ id: 'h1', currency: 'USD', balanceMinorUnits: 10_000 })],
      accounts,
      rateTable,
      baseCurrency: 'UAH',
      now,
    });

    expect(Object.keys(snapshot).sort()).toEqual([
      'baseCurrency',
      'breakdown',
      'total',
      'updatedAt',
    ]);
  });
});
