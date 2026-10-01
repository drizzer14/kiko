import { isBalanceSetShapedRow } from './balance-set-row';

const openingRow = {
  source: 'manual' as const,
  description: '',
  category: null,
  exchangeCounterpartHoldingId: null,
  changeGroupId: null,
};

describe('isBalanceSetShapedRow', () => {
  it('matches the row an opening balance or a hand edit writes', () => {
    expect(isBalanceSetShapedRow(openingRow)).toBe(true);
  });

  it.each([
    ['a sync source', { source: 'monobank' as const }],
    ['an import', { source: 'import' as const }],
    ['a description', { description: 'Coffee' }],
    ['a category', { category: 'groceries' }],
    ['an exchange leg marker', { exchangeCounterpartHoldingId: 'cash' }],
    ['a change-return marker', { changeGroupId: 'group' }],
  ])('does not match a row with %s', (_name, difference) => {
    expect(isBalanceSetShapedRow({ ...openingRow, ...difference })).toBe(false);
  });
});
