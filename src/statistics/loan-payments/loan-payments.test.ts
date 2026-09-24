import type { LoanMeta } from '../../holdings/holding-metadata';

import {
  type LoanHolding,
  type LoanPaymentTransaction,
  loanInterestEntries,
  loanPaymentExcludedTxIds,
  LOAN_INTEREST_CATEGORY_KEY,
} from './loan-payments';

// A single-installment (termMonths: 1) annuity loan: its whole schedule is
// one installment, so `loanInterestForPaymentMinor` never has to pick among
// several — the payment maps to it directly. `principalMinorUnits: 900_000`
// at 12% annual (1% monthly) gives `round(900_000 * 0.01) = 9_000` interest,
// matching the brief's own illustrative numbers.
const scheduledMeta: LoanMeta = {
  kind: 'personal',
  principalMinorUnits: 900_000,
  startDate: new Date(2024, 0, 1).getTime(),
  annualRatePct: 12,
  termMonths: 1,
  schedule: 'annuity',
};

const informalMeta: LoanMeta = {
  kind: 'personal',
  principalMinorUnits: 50_000_00,
  startDate: new Date(2024, 0, 1).getTime(),
  schedule: 'none',
};

const PAYMENT_TIME = new Date(2024, 0, 5).getTime();

const scheduledLoan: LoanHolding = { id: 'loan-scheduled', metadata: scheduledMeta };
const informalLoan: LoanHolding = { id: 'loan-informal', metadata: informalMeta };

const linkedPayment: LoanPaymentTransaction = {
  id: 'tx-linked',
  loanHoldingId: 'loan-scheduled',
  time: PAYMENT_TIME,
  amountMinorUnits: -12_000,
  currency: 'UAH',
};

describe('loanPaymentExcludedTxIds', () => {
  it('excludes a linked payment whose loan holding exists', () => {
    const ids = loanPaymentExcludedTxIds([linkedPayment], [scheduledLoan]);

    expect(ids.has('tx-linked')).toBe(true);
  });

  it('does not exclude an unlinked payment (loanHoldingId null)', () => {
    const unlinked: LoanPaymentTransaction = {
      ...linkedPayment,
      id: 'tx-unlinked',
      loanHoldingId: null,
    };

    const ids = loanPaymentExcludedTxIds([unlinked], [scheduledLoan]);

    expect(ids.has('tx-unlinked')).toBe(false);
  });

  // Review Focus 7 (global-constraints.md): a link to a missing loan counts
  // as normal spending — a dangling `loanHoldingId` is not excluded.
  it('Review Focus 7: does not exclude a payment linked to a MISSING loan holding', () => {
    const dangling: LoanPaymentTransaction = {
      ...linkedPayment,
      id: 'tx-dangling',
      loanHoldingId: 'ghost-loan',
    };

    const ids = loanPaymentExcludedTxIds([dangling], [scheduledLoan]);

    expect(ids.has('tx-dangling')).toBe(false);
  });
});

describe('loanInterestEntries', () => {
  it('a linked -12,000 payment with installment interest 9,000 produces a 9,000 interest entry', () => {
    const entries = loanInterestEntries({
      transactions: [linkedPayment],
      loanHoldings: [scheduledLoan],
    });

    expect(entries).toEqual([
      {
        id: 'loan-interest:tx-linked',
        category: LOAN_INTEREST_CATEGORY_KEY,
        amountMinorUnits: -9_000,
        mcc: null,
        counterIban: null,
        description: '',
        exchangeCounterpartHoldingId: null,
        changeGroupId: null,
        currency: 'UAH',
        time: PAYMENT_TIME,
      },
    ]);
  });

  it('an informal (none-schedule) loan payment counts 0 interest — no entry', () => {
    const informalPayment: LoanPaymentTransaction = {
      ...linkedPayment,
      id: 'tx-informal',
      loanHoldingId: 'loan-informal',
    };

    const entries = loanInterestEntries({
      transactions: [informalPayment],
      loanHoldings: [informalLoan],
    });

    expect(entries).toEqual([]);
  });

  it('an unlinked payment produces no interest entry', () => {
    const unlinked: LoanPaymentTransaction = {
      ...linkedPayment,
      id: 'tx-unlinked',
      loanHoldingId: null,
    };

    const entries = loanInterestEntries({
      transactions: [unlinked],
      loanHoldings: [scheduledLoan],
    });

    expect(entries).toEqual([]);
  });

  it('Review Focus 7: a payment linked to a MISSING loan holding produces no interest entry', () => {
    const dangling: LoanPaymentTransaction = {
      ...linkedPayment,
      id: 'tx-dangling',
      loanHoldingId: 'ghost-loan',
    };

    const entries = loanInterestEntries({
      transactions: [dangling],
      loanHoldings: [scheduledLoan],
    });

    expect(entries).toEqual([]);
  });

  it('caps the counted interest at the payment amount for a partial payment', () => {
    const partial: LoanPaymentTransaction = {
      ...linkedPayment,
      id: 'tx-partial',
      amountMinorUnits: -4_000,
    };

    const entries = loanInterestEntries({ transactions: [partial], loanHoldings: [scheduledLoan] });

    expect(entries).toEqual([expect.objectContaining({ amountMinorUnits: -4_000 })]);
  });
});
