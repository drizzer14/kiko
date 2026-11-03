import type { LoanMeta } from '@kiko/holdings/holding-metadata';

import { type LoanHolding, type LoanPaymentTransaction, loanInterestEntries } from '.';

// One installment: 900_000 principal at 12% annual gives 9_000 interest, and a payment in parts
// counts that interest once, on the earliest part.
const scheduledMeta: LoanMeta = {
  kind: 'personal',
  principalMinorUnits: 900_000,
  startDate: new Date(2024, 0, 1).getTime(),
  annualRatePct: 12,
  termMonths: 1,
  schedule: 'annuity',
};

const loan: LoanHolding = { id: 'loan', metadata: scheduledMeta, currency: 'UAH' };

const payment = (
  id: string,
  day: number,
  overrides: Partial<LoanPaymentTransaction> = {},
): LoanPaymentTransaction => ({
  id,
  loanHoldingId: 'loan',
  time: new Date(2024, 0, day).getTime(),
  amountMinorUnits: -12_000,
  currency: 'UAH',
  category: 'utilities',
  ...overrides,
});

const marked = payment('marked', 5, { setsBalance: true });
const other = payment('other', 6);

const idsOf = (entries: readonly { id: string }[]): string[] => entries.map((entry) => entry.id);

describe('loanInterestEntries and a row that sets a balance', () => {
  it('emits no interest or excess entry for a marked negative row linked to a loan', () => {
    const entries = loanInterestEntries({ transactions: [marked], loanHoldings: [loan] });

    expect(entries).toEqual([]);
  });

  it('splits the loan’s other payments as if the marked row did not exist', () => {
    const withMarked = loanInterestEntries({
      transactions: [marked, other],
      loanHoldings: [loan],
    });
    const without = loanInterestEntries({ transactions: [other], loanHoldings: [loan] });

    expect(withMarked).toEqual(without);
    expect(idsOf(withMarked)).toEqual(['loan-interest:other']);
    expect(withMarked[0].amountMinorUnits).toBe(-9_000);
  });

  it('still derives the entries of an unmarked row of the same shape', () => {
    const unmarked = payment('unmarked', 5);
    const entries = loanInterestEntries({ transactions: [unmarked], loanHoldings: [loan] });

    expect(idsOf(entries)).toEqual(['loan-interest:unmarked']);
  });

  it('treats a row with the mark explicitly false as an ordinary payment', () => {
    const explicit = payment('explicit', 5, { setsBalance: false });

    expect(idsOf(loanInterestEntries({ transactions: [explicit], loanHoldings: [loan] }))).toEqual([
      'loan-interest:explicit',
    ]);
  });
});
