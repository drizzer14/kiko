import {
  movesBalance,
  balanceBoundaryOf,
  isPossibleBalanceSetRow,
  importDeleteKeepsBalance,
  redatesPossibleBalanceSetRowPastBoundary,
} from './balance-boundary';

const BOUNDARY = 1_000;

const unmarkedShapedRow = {
  time: 500,
  setsBalance: false,
  source: 'manual' as const,
  description: '',
  category: null,
  exchangeCounterpartHoldingId: null,
  changeGroupId: null,
};

describe('balanceBoundaryOf', () => {
  it.each([
    ['neither source', null, null, null],
    ['only a balance set', 700, null, 700],
    ['only a synced row', null, 900, 900],
    ['a later balance set', 1_200, 900, 1_200],
    ['a later synced row', 700, 900, 900],
  ])('takes %s', (_name, balanceSetAt, newestSyncTime, expected) => {
    expect(balanceBoundaryOf({ balanceSetAt, newestSyncTime })).toBe(expected);
  });
});

describe('movesBalance', () => {
  it('moves the balance for any row while the holding has no boundary', () => {
    expect(movesBalance(0, null)).toBe(true);
  });

  it('moves the balance only for a row dated strictly after the boundary', () => {
    expect(movesBalance(BOUNDARY - 1, BOUNDARY)).toBe(false);
    expect(movesBalance(BOUNDARY, BOUNDARY)).toBe(false);
    expect(movesBalance(BOUNDARY + 1, BOUNDARY)).toBe(true);
  });
});

describe('importDeleteKeepsBalance', () => {
  it.each([
    ['before the boundary', BOUNDARY - 1],
    ['exactly at the boundary', BOUNDARY],
  ])('holds for an imported row dated %s', (_name, time) => {
    expect(importDeleteKeepsBalance({ source: 'import', time }, BOUNDARY)).toBe(true);
  });

  it('does not hold for an imported row dated after the boundary, whose delete gives the money back', () => {
    expect(importDeleteKeepsBalance({ source: 'import', time: BOUNDARY + 1 }, BOUNDARY)).toBe(
      false,
    );
  });

  it('does not hold while the holding has no boundary, so every row counts', () => {
    expect(importDeleteKeepsBalance({ source: 'import', time: 0 }, null)).toBe(false);
  });

  it.each(['manual', 'monobank'] as const)('does not hold for a %s row', (source) => {
    expect(importDeleteKeepsBalance({ source, time: BOUNDARY - 1 }, BOUNDARY)).toBe(false);
  });
});

describe('isPossibleBalanceSetRow', () => {
  it('holds for an unmarked balance-set-shaped row', () => {
    expect(isPossibleBalanceSetRow(unmarkedShapedRow)).toBe(true);
  });

  it.each([
    ['a marked row', { setsBalance: true }],
    ['a row with a description', { description: 'Coffee' }],
    ['a row with a category', { category: 'groceries' }],
  ])('does not hold for %s', (_name, difference) => {
    expect(isPossibleBalanceSetRow({ ...unmarkedShapedRow, ...difference })).toBe(false);
  });
});

describe('redatesPossibleBalanceSetRowPastBoundary', () => {
  it('refuses an unmarked balance-set-shaped row moved from before the boundary to after it', () => {
    expect(
      redatesPossibleBalanceSetRowPastBoundary(unmarkedShapedRow, BOUNDARY + 1, BOUNDARY),
    ).toBe(true);
  });

  it('refuses the same row moved from exactly the boundary to after it', () => {
    expect(
      redatesPossibleBalanceSetRowPastBoundary(
        { ...unmarkedShapedRow, time: BOUNDARY },
        BOUNDARY + 1,
        BOUNDARY,
      ),
    ).toBe(true);
  });

  it.each([
    ['moved earlier', 100],
    ['moved within the history side', 800],
    ['moved to exactly the boundary', BOUNDARY],
  ])('allows the row %s', (_name, time) => {
    expect(redatesPossibleBalanceSetRowPastBoundary(unmarkedShapedRow, time, BOUNDARY)).toBe(false);
  });

  it('allows the row while the holding has no boundary', () => {
    expect(redatesPossibleBalanceSetRowPastBoundary(unmarkedShapedRow, 5_000, null)).toBe(false);
  });

  it('allows a row already after the boundary to move within the after side', () => {
    expect(
      redatesPossibleBalanceSetRowPastBoundary(
        { ...unmarkedShapedRow, time: BOUNDARY + 1 },
        BOUNDARY + 500,
        BOUNDARY,
      ),
    ).toBe(false);
  });

  it.each([
    ['a marked row', { setsBalance: true }],
    ['a row with a description', { description: 'Coffee' }],
    ['a row with a category', { category: 'groceries' }],
    ['an exchange leg', { exchangeCounterpartHoldingId: 'cash' }],
    ['a change return', { changeGroupId: 'group' }],
    ['a synced row', { source: 'monobank' as const }],
  ])('allows %s to move past the boundary', (_name, difference) => {
    expect(
      redatesPossibleBalanceSetRowPastBoundary(
        { ...unmarkedShapedRow, ...difference },
        BOUNDARY + 1,
        BOUNDARY,
      ),
    ).toBe(false);
  });
});
