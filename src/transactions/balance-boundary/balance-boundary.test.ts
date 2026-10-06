import { movesBalance, balanceBoundaryOf } from './balance-boundary';

const BOUNDARY = 1_000;

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
