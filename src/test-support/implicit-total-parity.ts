type ImplicitKind = 'property' | 'debt';

// One implicit account in USD (the base is UAH) whose only open item is held in UAH, with a
// USD to UAH rate of 40. The Accounts section heading and the account detail page total these
// same rows through `accountTotal`, so each screen's own test reads the same two strings: the
// total in the account currency and the base caption.
const IMPLICIT_PARITY_RATES = [{ base: 'USD', quote: 'UAH', rate: '40' }];

const PARITY = {
  property: {
    name: 'Properties',
    holdingName: 'Apartment',
    type: 'property_item',
    // 5,000.00 ₴ of cost basis: no price point is mocked, so the item values at its lot's cost.
    metadata: {
      category: 'real_estate',
      lots: [{ day: 1000, quantityDelta: '1', costMinorUnits: 500_000 }],
    },
    total: '$125.00',
    caption: '5,000.00 ₴',
  },
  debt: {
    name: 'Loans',
    holdingName: 'Mortgage',
    type: 'loan',
    // A loan that starts now has no installment due, so it stands at its full principal.
    metadata: {
      kind: 'personal',
      principalMinorUnits: 500_000,
      startDate: Date.now(),
      annualRatePct: 10,
      termMonths: 120,
      schedule: 'annuity',
    },
    total: '-$125.00',
    caption: '-5,000.00 ₴',
  },
} as const;

export const implicitParityFixture = (kind: ImplicitKind, accountId: string) => {
  const { name, holdingName, type, metadata, total, caption } = PARITY[kind];

  return {
    account: { id: accountId, name, kind, currency: 'USD', archivedAt: null },
    holdings: [
      {
        id: 'item-1',
        name: holdingName,
        accountId,
        currency: 'UAH',
        balanceMinorUnits: 0,
        type,
        metadata,
      },
    ],
    rates: IMPLICIT_PARITY_RATES,
    total,
    caption,
  };
};
