import type { LoanMeta } from '../../holdings/holding-metadata';

import {
  type LoanHolding,
  type LoanPaymentTransaction,
  loanInterestEntries,
  loanPaymentExcludedTransactionIds,
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

const scheduledLoan: LoanHolding = {
  id: 'loan-scheduled',
  metadata: scheduledMeta,
  currency: 'UAH',
};
const informalLoan: LoanHolding = { id: 'loan-informal', metadata: informalMeta, currency: 'UAH' };

const linkedPayment: LoanPaymentTransaction = {
  id: 'tx-linked',
  loanHoldingId: 'loan-scheduled',
  time: PAYMENT_TIME,
  amountMinorUnits: -12_000,
  currency: 'UAH',
};

describe('loanPaymentExcludedTransactionIds', () => {
  it('excludes a linked payment whose loan holding exists', () => {
    const ids = loanPaymentExcludedTransactionIds([linkedPayment], [scheduledLoan]);

    expect(ids.has('tx-linked')).toBe(true);
  });

  it('does not exclude an unlinked payment (loanHoldingId null)', () => {
    const unlinked: LoanPaymentTransaction = {
      ...linkedPayment,
      id: 'tx-unlinked',
      loanHoldingId: null,
    };

    const ids = loanPaymentExcludedTransactionIds([unlinked], [scheduledLoan]);

    expect(ids.has('tx-unlinked')).toBe(false);
  });

  // A link to a missing loan counts as normal spending — a dangling
  // `loanHoldingId` is not excluded.
  it('does not exclude a payment linked to a MISSING loan holding', () => {
    const dangling: LoanPaymentTransaction = {
      ...linkedPayment,
      id: 'tx-dangling',
      loanHoldingId: 'ghost-loan',
    };

    const ids = loanPaymentExcludedTransactionIds([dangling], [scheduledLoan]);

    expect(ids.has('tx-dangling')).toBe(false);
  });

  // A USD loan paid from a UAH card (or vice versa) is a common case for
  // Kiko's users; the write path (`transactionsRepo.setLoanPayment`) refuses
  // such a link going forward, but a link written before that guard existed
  // must still read back as ordinary spending, not a wrong-currency interest
  // entry.
  it('does not exclude a payment whose currency differs from its linked loan holding currency', () => {
    const crossCurrency: LoanPaymentTransaction = {
      ...linkedPayment,
      id: 'tx-cross-currency',
      currency: 'USD',
    };

    const ids = loanPaymentExcludedTransactionIds([crossCurrency], [scheduledLoan]);

    expect(ids.has('tx-cross-currency')).toBe(false);
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

  it('produces no interest entry for a payment whose currency differs from its linked loan holding currency', () => {
    const crossCurrency: LoanPaymentTransaction = {
      ...linkedPayment,
      id: 'tx-cross-currency',
      currency: 'USD',
    };

    const entries = loanInterestEntries({
      transactions: [crossCurrency],
      loanHoldings: [scheduledLoan],
    });

    expect(entries).toEqual([]);
  });

  // A linked row can be edited after linking from a debit into a credit (e.g.
  // a returned/reversed payment); a credit is not spending, so it must not
  // manufacture a negative "Loan interest" entry either.
  it('produces no interest entry for a linked CREDIT (a positive amount)', () => {
    const credit: LoanPaymentTransaction = {
      ...linkedPayment,
      id: 'tx-credit',
      amountMinorUnits: 12_000,
    };

    const entries = loanInterestEntries({ transactions: [credit], loanHoldings: [scheduledLoan] });

    expect(entries).toEqual([]);
  });
});
