import type { HoldingRow, TransactionRow } from '@kiko/db';

import { loanInstallments } from '../../holdings/loan-schedule';
import type { LoanMeta } from '../../holdings/holding-metadata';

import {
  type LinkedLoanPayment,
  matchLoanPayments,
  type MatchableTransaction,
  normalizeIban,
} from './payment-matcher';

const NOW = Date.UTC(2026, 8, 26);
const START_DATE = Date.UTC(2025, 0, 15);

// An interest-free 12-installment annuity so each installment's own payment
// is an exact, easy-to-reason-about round number (1,000.00 UAH): principal
// 12,000.00 UAH / 12 months, 0% rate.
const baseLoanMeta = (overrides: Partial<LoanMeta> = {}): LoanMeta => ({
  kind: 'mortgage',
  principalMinorUnits: 1_200_000,
  startDate: START_DATE,
  annualRatePct: 0,
  termMonths: 12,
  schedule: 'annuity',
  ...overrides,
});

const loanHolding = (
  overrides: Partial<LoanMeta> = {},
  holdingOverrides: Partial<Pick<HoldingRow, 'id' | 'currency' | 'closedAt'>> = {},
): Pick<HoldingRow, 'id' | 'currency' | 'metadata'> => ({
  id: 'loan-1',
  currency: 'UAH',
  metadata: baseLoanMeta(overrides),
  ...holdingOverrides,
});

// Every field the matcher's own candidate filter (rule 9-11 below) reads,
// defaulted to the "obviously eligible" shape so each test only overrides
// what it is actually exercising.
const baseTransaction = (overrides: Partial<MatchableTransaction> = {}): MatchableTransaction => ({
  id: 'txn-1',
  holdingId: 'payer-1',
  currency: 'UAH',
  amountMinorUnits: -100_000,
  time: NOW,
  description: '',
  counterIban: null,
  loanHoldingId: null,
  loanLinkRejected: false,
  exchangeCounterpartHoldingId: null,
  ...overrides,
});

// The real first installment off the shared schedule above — every
// amount/date test anchors on this rather than a hand-picked literal, so a
// test can never silently drift from what `loanInstallments` actually
// produces.
const firstInstallment = loanInstallments(baseLoanMeta())[0];

describe('matchLoanPayments', () => {
  it('links a debit whose amount and date match an installment, paid from the loan’s own paymentHoldingId', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toEqual([
      { transactionId: 'txn-1', loanHoldingId: 'loan-1', dueDate: firstInstallment.dueDate },
    ]);
  });

  it.each(['кредит', 'погашення', 'іпотек', 'позик', 'loan', 'mortgage', 'repayment'])(
    'links a debit whose description carries the keyword %j',
    (keyword) => {
      const loan = loanHolding();
      const transaction = baseTransaction({
        amountMinorUnits: -firstInstallment.paymentMinorUnits,
        time: firstInstallment.dueDate,
        description: `Monthly ${keyword} payment`,
      });

      const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

      expect(matches).toEqual([
        { transactionId: 'txn-1', loanHoldingId: 'loan-1', dueDate: firstInstallment.dueDate },
      ]);
    },
  );

  it('links a debit whose description carries the lender’s own name', () => {
    const loan = loanHolding({ lenderName: 'PrivatBank' });
    const transaction = baseTransaction({
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
      description: 'Payment to privatbank',
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toHaveLength(1);
  });

  it('links a debit whose counterIban equals the lenderIban', () => {
    const loan = loanHolding({ lenderIban: 'UA123456789012345678901234567' });
    const transaction = baseTransaction({
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
      counterIban: 'UA123456789012345678901234567',
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toHaveLength(1);
  });

  it('does not link amount + date alone with no third signal (e.g. same-size rent)', () => {
    const loan = loanHolding();
    const transaction = baseTransaction({
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
      description: 'Monthly rent',
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toEqual([]);
  });

  it('does not link an amount outside the tolerance (more than 1% or 1.00, whichever is larger)', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -(firstInstallment.paymentMinorUnits + 5_000),
      time: firstInstallment.dueDate,
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toEqual([]);
  });

  it('links an amount within tolerance (a bank fee/rounding of a few kopecks)', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -(firstInstallment.paymentMinorUnits + 50),
      time: firstInstallment.dueDate,
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toHaveLength(1);
  });

  it('does not link a transaction more than 7 days after the due date', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate + 8 * 24 * 60 * 60 * 1000,
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toEqual([]);
  });

  it('does not link a transaction more than 3 days before the due date', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate - 4 * 24 * 60 * 60 * 1000,
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toEqual([]);
  });

  it('links a transaction exactly 3 days before the due date (inclusive lower bound)', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const before = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate - 3 * 24 * 60 * 60 * 1000,
    });

    const matches = matchLoanPayments({ transactions: [before], loans: [loan], now: NOW });

    expect(matches).toHaveLength(1);
  });

  it('links a transaction exactly 7 days after the due date (inclusive upper bound)', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const after = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate + 7 * 24 * 60 * 60 * 1000,
    });

    const matches = matchLoanPayments({ transactions: [after], loans: [loan], now: NOW });

    expect(matches).toHaveLength(1);
  });

  it('links no candidate when two transactions both match the same installment (ambiguous)', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const first = baseTransaction({
      id: 'txn-1',
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
    });
    const second = baseTransaction({
      id: 'txn-2',
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
    });

    const matches = matchLoanPayments({
      transactions: [first, second],
      loans: [loan],
      now: NOW,
    });

    expect(matches).toEqual([]);
  });

  it('does not link a transaction that matches installments of two different loans', () => {
    const loanA = loanHolding({ paymentHoldingId: 'payer-1' }, { id: 'loan-a' });
    const loanB = loanHolding({ paymentHoldingId: 'payer-1' }, { id: 'loan-b' });
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
    });

    const matches = matchLoanPayments({
      transactions: [transaction],
      loans: [loanA, loanB],
      now: NOW,
    });

    expect(matches).toEqual([]);
  });

  it('never links a row already marked loanLinkRejected', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
      loanLinkRejected: true,
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toEqual([]);
  });

  it('never re-proposes a link for a row that is already linked (unchanged)', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
      loanHoldingId: 'some-other-loan',
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toEqual([]);
  });

  it('never links an exchange leg, even with matching amount/date/signal', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
      exchangeCounterpartHoldingId: 'other-holding',
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toEqual([]);
  });

  it('never links a credit (a positive amount), even with matching magnitude/date/signal', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toEqual([]);
  });

  it('does not link a transaction in a different currency than the loan', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      currency: 'USD',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toEqual([]);
  });

  it('never links any payment against an informal (schedule: "none") loan', () => {
    const loan = loanHolding({ schedule: 'none', annualRatePct: undefined, termMonths: undefined });
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
      description: 'loan payment',
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toEqual([]);
  });

  it('is idempotent: re-running once the row is already linked proposes nothing further', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
    });

    const firstRun = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });
    expect(firstRun).toHaveLength(1);

    const alreadyLinked: TransactionRow['loanHoldingId'] = firstRun[0].loanHoldingId;
    const secondRun = matchLoanPayments({
      transactions: [{ ...transaction, loanHoldingId: alreadyLinked }],
      loans: [loan],
      now: NOW,
    });

    expect(secondRun).toEqual([]);
  });

  it('backfills a payment against a PAST installment (not just the next unpaid one)', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const installments = loanInstallments(baseLoanMeta());
    const thirdInstallment = installments[2];
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -thirdInstallment.paymentMinorUnits,
      time: thirdInstallment.dueDate,
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toEqual([
      { transactionId: 'txn-1', loanHoldingId: 'loan-1', dueDate: thirdInstallment.dueDate },
    ]);
  });
});

// `loanMatchCandidatesQuery` (the real caller) drops an already-linked row
// from `transactions`, so without `linkedPayments` the
// installment it paid would look unpaid again on the next run — a later
// same-amount candidate (with its OWN valid third signal) would then take
// its place, double-counting one installment across two real payments.
describe('matchLoanPayments — an installment already taken', () => {
  it('does not link a later same-amount candidate for an installment a manually linked payment already took', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    // A same-size rent, paid from the SAME holding the loan is paid from —
    // its own third signal would otherwise be enough to link it.
    const rent = baseTransaction({
      id: 'txn-rent',
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
    });
    const linkedPayments: LinkedLoanPayment[] = [
      {
        loanHoldingId: 'loan-1',
        amountMinorUnits: -firstInstallment.paymentMinorUnits,
        time: firstInstallment.dueDate,
      },
    ];

    const matches = matchLoanPayments({
      transactions: [rent],
      loans: [loan],
      linkedPayments,
      now: NOW,
    });

    expect(matches).toEqual([]);
  });

  it('still links a fresh candidate when the only linked payment belongs to a DIFFERENT loan', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
    });
    const linkedPayments: LinkedLoanPayment[] = [
      {
        loanHoldingId: 'some-other-loan',
        amountMinorUnits: -firstInstallment.paymentMinorUnits,
        time: firstInstallment.dueDate,
      },
    ];

    const matches = matchLoanPayments({
      transactions: [transaction],
      loans: [loan],
      linkedPayments,
      now: NOW,
    });

    expect(matches).toHaveLength(1);
  });

  it('links normally when linkedPayments is omitted (backward-compatible default)', () => {
    const loan = loanHolding({ paymentHoldingId: 'payer-1' });
    const transaction = baseTransaction({
      holdingId: 'payer-1',
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toHaveLength(1);
  });
});

// The IBAN comparison must not false-negative on cosmetic
// differences (case, grouping spaces) between what the user typed on the
// loan form and what a bank feed's own counterIban carries; a lenderName
// shorter than 3 characters is too likely to appear inside an unrelated
// description by coincidence to count as a real signal.
describe('matchLoanPayments — IBAN normalization and lender-name length', () => {
  it('matches a lenderIban stored with different case/whitespace against a clean counterIban', () => {
    const loan = loanHolding({ lenderIban: ' ua123456789012345678901234567 ' });
    const transaction = baseTransaction({
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
      counterIban: 'UA123456789012345678901234567',
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toHaveLength(1);
  });

  it('matches a counterIban carrying grouping spaces against a clean lenderIban', () => {
    const loan = loanHolding({ lenderIban: 'UA123456789012345678901234567' });
    const transaction = baseTransaction({
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
      counterIban: 'ua12 3456 7890 1234 5678 9012 3456 7',
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toHaveLength(1);
  });

  it('does not link on a lenderName shorter than 3 characters, even when it appears in the description', () => {
    const loan = loanHolding({ lenderName: 'Jo' });
    const transaction = baseTransaction({
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
      description: 'Payment to Jo',
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toEqual([]);
  });

  it('links on a lenderName of exactly 3 characters', () => {
    const loan = loanHolding({ lenderName: 'ICU' });
    const transaction = baseTransaction({
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
      description: 'Payment to ICU',
    });

    const matches = matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

    expect(matches).toHaveLength(1);
  });
});

describe('normalizeIban', () => {
  it('trims, uppercases, and strips internal grouping whitespace', () => {
    expect(normalizeIban(' ua12 3456 7890 ')).toBe('UA1234567890');
  });

  it('is a no-op on an already-normalized IBAN', () => {
    expect(normalizeIban('UA123456789012345678901234567')).toBe('UA123456789012345678901234567');
  });
});
