import { exchangeExcludedTransactionIds } from './exchange-exclusion';

describe('exchangeExcludedTransactionIds', () => {
  it('excludes both legs of a cross-currency exchange', () => {
    const ids = exchangeExcludedTransactionIds([
      { id: 'out', exchangeCounterpartHoldingId: 'h-usd', untrackedCounterpart: null },
      { id: 'in', exchangeCounterpartHoldingId: 'h-uah', untrackedCounterpart: null },
      { id: 'groceries', exchangeCounterpartHoldingId: null, untrackedCounterpart: null },
    ]);

    expect(ids).toEqual(new Set(['out', 'in']));
  });

  it('excludes a single-legged exchange into a term deposit', () => {
    // A term_deposit destination writes a metadata contribution, not a credit
    // row, so only the debit leg exists — nothing cancels it.
    expect(
      exchangeExcludedTransactionIds([
        { id: 'out', exchangeCounterpartHoldingId: 'h-dep', untrackedCounterpart: null },
      ]),
    ).toEqual(new Set(['out']));
  });

  it('excludes a row whose only marker is an untracked counterpart', () => {
    // A move to a wallet Kiko does not track has no counterpart holding, so only
    // the untracked code keeps it out of spending.
    expect(
      exchangeExcludedTransactionIds([
        {
          id: 'futures',
          exchangeCounterpartHoldingId: null,
          untrackedCounterpart: 'wallet:UMFUTURE',
        },
      ]),
    ).toEqual(new Set(['futures']));
  });

  it('returns an empty set for an ordinary ledger', () => {
    expect(
      exchangeExcludedTransactionIds([
        { id: 'a', exchangeCounterpartHoldingId: null, untrackedCounterpart: null },
      ]).size,
    ).toBe(0);
  });
});
