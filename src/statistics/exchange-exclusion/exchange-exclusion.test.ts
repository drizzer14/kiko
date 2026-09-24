import { exchangeExcludedTransactionIds } from './exchange-exclusion';

describe('exchangeExcludedTxIds', () => {
  it('excludes both legs of a cross-currency exchange', () => {
    const ids = exchangeExcludedTransactionIds([
      { id: 'out', exchangeCounterpartHoldingId: 'h-usd' },
      { id: 'in', exchangeCounterpartHoldingId: 'h-uah' },
      { id: 'groceries', exchangeCounterpartHoldingId: null },
    ]);

    expect(ids).toEqual(new Set(['out', 'in']));
  });

  it('excludes a single-legged exchange into a term deposit', () => {
    // A term_deposit destination writes a metadata contribution, not a credit
    // row, so only the debit leg exists — nothing cancels it.
    expect(
      exchangeExcludedTransactionIds([{ id: 'out', exchangeCounterpartHoldingId: 'h-dep' }]),
    ).toEqual(new Set(['out']));
  });

  it('returns an empty set for an ordinary ledger', () => {
    expect(
      exchangeExcludedTransactionIds([{ id: 'a', exchangeCounterpartHoldingId: null }]).size,
    ).toBe(0);
  });
});
