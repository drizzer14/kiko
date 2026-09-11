import { activeHoldings } from './active-holdings';

const accounts = [
  { id: 'a1', archivedAt: null },
  { id: 'a2', archivedAt: 1_700_000_000_000 }, // archived
];

describe('activeHoldings', () => {
  it('keeps only open holdings under non-archived accounts', () => {
    const holdings = [
      { accountId: 'a1', closedAt: null, name: 'keep' },
      { accountId: 'a1', closedAt: 123, name: 'closed' },
      { accountId: 'a2', closedAt: null, name: 'archived-parent' },
    ];

    expect(activeHoldings(holdings, accounts).map((holding) => holding.name)).toEqual(['keep']);
  });

  it('returns an empty list when every account is archived', () => {
    const holdings = [{ accountId: 'a2', closedAt: null, name: 'x' }];

    expect(activeHoldings(holdings, accounts)).toEqual([]);
  });
});
