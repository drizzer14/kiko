import {
  exchangeExcludedTransactionIds,
  sameCurrencyMoveTransactionIds,
} from './exchange-exclusion';

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

  it.each([
    ['asset:PEPE'],
    ['p2p:UAH:4150.00'],
    ['card:UAH:2600.00'],
    ['bank:EUR:100.00'],
    ['p2p:UAH:abc'],
  ])(
    'excludes a row with each new code form, a malformed total included: %s',
    (untrackedCounterpart) => {
      expect(
        exchangeExcludedTransactionIds([
          { id: 'row', exchangeCounterpartHoldingId: null, untrackedCounterpart },
        ]),
      ).toEqual(new Set(['row']));
    },
  );

  it('returns an empty set for an ordinary ledger', () => {
    expect(
      exchangeExcludedTransactionIds([
        { id: 'a', exchangeCounterpartHoldingId: null, untrackedCounterpart: null },
      ]).size,
    ).toBe(0);
  });
});

describe('sameCurrencyMoveTransactionIds', () => {
  const leg = (
    overrides: Partial<Parameters<typeof sameCurrencyMoveTransactionIds>[0][number]> & {
      id: string;
    },
  ): Parameters<typeof sameCurrencyMoveTransactionIds>[0][number] => ({
    holdingId: 'bank',
    amountMinorUnits: -500_00,
    currency: 'UAH',
    exchangePairId: 'pair-1',
    ...overrides,
  });

  it('excludes both legs of a pair that is equal and opposite in one currency on two holdings', () => {
    expect(
      sameCurrencyMoveTransactionIds([
        leg({ id: 'debit' }),
        leg({ id: 'credit', holdingId: 'cash', amountMinorUnits: 500_00 }),
      ]),
    ).toEqual(new Set(['debit', 'credit']));
  });

  it('keeps a pair whose amounts differ', () => {
    expect(
      sameCurrencyMoveTransactionIds([
        leg({ id: 'debit' }),
        leg({ id: 'credit', holdingId: 'cash', amountMinorUnits: 490_00 }),
      ]).size,
    ).toBe(0);
  });

  it('keeps a pair across two currencies', () => {
    expect(
      sameCurrencyMoveTransactionIds([
        leg({ id: 'debit' }),
        leg({ id: 'credit', holdingId: 'wallet', amountMinorUnits: 500_00, currency: 'USD' }),
      ]).size,
    ).toBe(0);
  });

  it('keeps a pair whose two legs sit on one holding', () => {
    expect(
      sameCurrencyMoveTransactionIds([
        leg({ id: 'debit' }),
        leg({ id: 'credit', amountMinorUnits: 500_00 }),
      ]).size,
    ).toBe(0);
  });

  it('never reaches a row of another pair or a row with no pair id', () => {
    expect(
      sameCurrencyMoveTransactionIds([
        leg({ id: 'debit' }),
        leg({
          id: 'other-pair',
          holdingId: 'cash',
          amountMinorUnits: 500_00,
          exchangePairId: 'pair-2',
        }),
        leg({ id: 'unmarked', holdingId: 'cash', amountMinorUnits: 500_00, exchangePairId: null }),
        leg({ id: 'unmarked-debit', holdingId: 'cash', exchangePairId: null }),
      ]).size,
    ).toBe(0);
  });

  it('claims one credit for one debit', () => {
    expect(
      sameCurrencyMoveTransactionIds([
        leg({ id: 'first-debit' }),
        leg({ id: 'second-debit', holdingId: 'card' }),
        leg({ id: 'credit', holdingId: 'cash', amountMinorUnits: 500_00 }),
      ]),
    ).toEqual(new Set(['first-debit', 'credit']));
  });
});
