import { DAY_MS } from '@kiko/dates';
import type { HoldingRow, TransactionRow } from '@kiko/db';
import { loanInstallments } from '@kiko/holdings/loan-schedule';
import type { LoanMeta } from '@kiko/holdings/holding-metadata';

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
  untrackedCounterpart: null,
  ...overrides,
});

// The real first installment off the shared schedule above — every
// amount/date test anchors on this rather than a hand-picked literal, so a
// test can never silently drift from what `loanInstallments` actually
// produces.
const firstInstallment = loanInstallments(baseLoanMeta())[0];

// A loan paid from the holding every `baseTransaction` is debited on.
const payerLoan = () => loanHolding({ paymentHoldingId: 'payer-1' });

// A debit of the first installment's size on its due date, before any override.
const installmentDebit = (overrides: Partial<MatchableTransaction> = {}): MatchableTransaction =>
  baseTransaction({
    amountMinorUnits: -firstInstallment.paymentMinorUnits,
    time: firstInstallment.dueDate,
    ...overrides,
  });

const matchesOf = (
  transaction: MatchableTransaction,
  loan: Pick<HoldingRow, 'id' | 'currency' | 'metadata'> = payerLoan(),
) => matchLoanPayments({ transactions: [transaction], loans: [loan], now: NOW });

const firstInstallmentMatch = {
  transactionId: 'txn-1',
  loanHoldingId: 'loan-1',
  dueDate: firstInstallment.dueDate,
};

describe('matchLoanPayments', () => {
  it('links a debit whose amount and date match an installment, paid from the loan’s own paymentHoldingId', () => {
    expect(matchesOf(installmentDebit())).toEqual([firstInstallmentMatch]);
  });

  it.each(['кредит', 'погашення', 'іпотек', 'позик', 'loan', 'mortgage', 'repayment'])(
    'links a debit whose description carries the keyword %j',
    (keyword) => {
      const matches = matchesOf(
        installmentDebit({ description: `Monthly ${keyword} payment` }),
        loanHolding(),
      );

      expect(matches).toEqual([firstInstallmentMatch]);
    },
  );

  it('links a debit whose description carries the lender’s own name', () => {
    const matches = matchesOf(
      installmentDebit({ description: 'Payment to privatbank' }),
      loanHolding({ lenderName: 'PrivatBank' }),
    );

    expect(matches).toHaveLength(1);
  });

  it('links a debit whose counterIban equals the lenderIban', () => {
    const matches = matchesOf(
      installmentDebit({ counterIban: 'UA123456789012345678901234567' }),
      loanHolding({ lenderIban: 'UA123456789012345678901234567' }),
    );

    expect(matches).toHaveLength(1);
  });

  it('does not link amount + date alone with no third signal (e.g. same-size rent)', () => {
    const matches = matchesOf(installmentDebit({ description: 'Monthly rent' }), loanHolding());

    expect(matches).toEqual([]);
  });

  // The installment is 1,000.00 UAH, so 1% (10.00) is the tolerance: a bank
  // fee/rounding of a few kopecks links, 50.00 off does not.
  it.each([
    [50, 1],
    [5_000, 0],
    [1_000, 1],
    [1_001, 0],
    [-1_000, 1],
    [-1_001, 0],
  ])('links an amount %i minor units off the installment: %i match(es)', (offset, expected) => {
    const matches = matchesOf(
      installmentDebit({ amountMinorUnits: -(firstInstallment.paymentMinorUnits + offset) }),
    );

    expect(matches).toHaveLength(expected);
  });

  // The window is 3 days before to 7 days after the due date, both bounds inclusive.
  it.each([
    [-4, 0],
    [-3, 1],
    [7, 1],
    [8, 0],
  ])('links a transaction %i days from the due date: %i match(es)', (days, expected) => {
    const matches = matchesOf(installmentDebit({ time: firstInstallment.dueDate + days * DAY_MS }));

    expect(matches).toHaveLength(expected);
  });

  it('links no candidate when two transactions both match the same installment (ambiguous)', () => {
    const matches = matchLoanPayments({
      transactions: [installmentDebit({ id: 'txn-1' }), installmentDebit({ id: 'txn-2' })],
      loans: [payerLoan()],
      now: NOW,
    });

    expect(matches).toEqual([]);
  });

  it('does not link a transaction that matches installments of two different loans', () => {
    const matches = matchLoanPayments({
      transactions: [installmentDebit()],
      loans: [
        loanHolding({ paymentHoldingId: 'payer-1' }, { id: 'loan-a' }),
        loanHolding({ paymentHoldingId: 'payer-1' }, { id: 'loan-b' }),
      ],
      now: NOW,
    });

    expect(matches).toEqual([]);
  });

  it.each([
    ['a row already marked loanLinkRejected', { loanLinkRejected: true }],
    ['a row that is already linked (unchanged)', { loanHoldingId: 'some-other-loan' }],
    [
      'an exchange leg, even with matching amount/date/signal',
      { exchangeCounterpartHoldingId: 'other-holding' },
    ],
    [
      'a credit (a positive amount), even with matching magnitude/date/signal',
      { amountMinorUnits: firstInstallment.paymentMinorUnits },
    ],
    ['a transaction in a different currency than the loan', { currency: 'USD' }],
  ] as const)('never links %s', (_label, overrides) => {
    expect(matchesOf(installmentDebit(overrides))).toEqual([]);
  });

  it('never links a move to a wallet Kiko does not track, even with matching amount/date/signal', () => {
    const matches = matchesOf(
      installmentDebit({
        holdingId: 'binance-spot',
        currency: 'BTC',
        untrackedCounterpart: 'wallet:UMFUTURE',
      }),
      loanHolding({ paymentHoldingId: 'binance-spot' }, { currency: 'BTC' }),
    );

    expect(matches).toEqual([]);
  });

  it('never links any payment against an informal (schedule: "none") loan', () => {
    const matches = matchesOf(
      installmentDebit({ description: 'loan payment' }),
      loanHolding({ schedule: 'none', annualRatePct: undefined, termMonths: undefined }),
    );

    expect(matches).toEqual([]);
  });

  it('is idempotent: re-running once the row is already linked proposes nothing further', () => {
    const transaction = installmentDebit();

    const firstRun = matchesOf(transaction);
    expect(firstRun).toHaveLength(1);

    const alreadyLinked: TransactionRow['loanHoldingId'] = firstRun[0].loanHoldingId;
    const secondRun = matchesOf({ ...transaction, loanHoldingId: alreadyLinked });

    expect(secondRun).toEqual([]);
  });

  it('backfills a payment against a PAST installment (not just the next unpaid one)', () => {
    const thirdInstallment = loanInstallments(baseLoanMeta())[2];
    const transaction = baseTransaction({
      amountMinorUnits: -thirdInstallment.paymentMinorUnits,
      time: thirdInstallment.dueDate,
    });

    expect(matchesOf(transaction)).toEqual([
      { transactionId: 'txn-1', loanHoldingId: 'loan-1', dueDate: thirdInstallment.dueDate },
    ]);
  });

  // 5 minor units over 8 months at 0% pays off by row 5 (1 each); rows 6-8
  // stay on the schedule with a zero payment. The 1.00 tolerance floor would
  // otherwise accept a real small debit against a payment that does not exist.
  it('never links a debit within the 1.00 floor to a zero-payment installment of a degenerate loan', () => {
    const degenerate: Partial<LoanMeta> = {
      principalMinorUnits: 5,
      termMonths: 8,
      schedule: 'differentiated',
    };
    const sixthInstallment = loanInstallments(baseLoanMeta(degenerate))[5];
    const transaction = baseTransaction({ amountMinorUnits: -50, time: sixthInstallment.dueDate });

    expect(sixthInstallment.paymentMinorUnits).toBe(0);
    expect(
      matchesOf(transaction, loanHolding({ ...degenerate, paymentHoldingId: 'payer-1' })),
    ).toEqual([]);
  });
});

// `loanMatchCandidatesQuery` (the real caller) drops an already-linked row
// from `transactions`, so without `linkedPayments` the
// installment it paid would look unpaid again on the next run — a later
// same-amount candidate (with its OWN valid third signal) would then take
// its place, double-counting one installment across two real payments.
describe('matchLoanPayments — an installment already taken', () => {
  const firstInstallmentPaidBy = (loanHoldingId: string): LinkedLoanPayment[] => [
    {
      loanHoldingId,
      amountMinorUnits: -firstInstallment.paymentMinorUnits,
      time: firstInstallment.dueDate,
    },
  ];

  const matchesWithLinked = (linkedPayments: LinkedLoanPayment[]) =>
    matchLoanPayments({
      transactions: [installmentDebit()],
      loans: [payerLoan()],
      linkedPayments,
      now: NOW,
    });

  it('does not link a later same-amount candidate for an installment a manually linked payment already took', () => {
    // A same-size rent, paid from the SAME holding the loan is paid from —
    // its own third signal would otherwise be enough to link it.
    expect(matchesWithLinked(firstInstallmentPaidBy('loan-1'))).toEqual([]);
  });

  it('still links a fresh candidate when the only linked payment belongs to a DIFFERENT loan', () => {
    expect(matchesWithLinked(firstInstallmentPaidBy('some-other-loan'))).toHaveLength(1);
  });

  it('links normally when linkedPayments is omitted (backward-compatible default)', () => {
    expect(matchesOf(installmentDebit())).toHaveLength(1);
  });
});

// The IBAN comparison must not false-negative on cosmetic
// differences (case, grouping spaces) between what the user typed on the
// loan form and what a bank feed's own counterIban carries; a lenderName
// shorter than 3 characters is too likely to appear inside an unrelated
// description by coincidence to count as a real signal.
describe('matchLoanPayments — IBAN normalization and lender-name length', () => {
  it.each([
    [
      'a lenderIban stored with different case/whitespace against a clean counterIban',
      ' ua123456789012345678901234567 ',
      'UA123456789012345678901234567',
    ],
    [
      'a counterIban carrying grouping spaces against a clean lenderIban',
      'UA123456789012345678901234567',
      'ua12 3456 7890 1234 5678 9012 3456 7',
    ],
  ])('matches %s', (_label, lenderIban, counterIban) => {
    const matches = matchesOf(installmentDebit({ counterIban }), loanHolding({ lenderIban }));

    expect(matches).toHaveLength(1);
  });

  it.each([
    [
      'does not link on a lenderName shorter than 3 characters, even when it appears in the description',
      'Jo',
      0,
    ],
    ['links on a lenderName of exactly 3 characters', 'ICU', 1],
  ])('%s', (_label, lenderName, expected) => {
    const matches = matchesOf(
      installmentDebit({ description: `Payment to ${lenderName}` }),
      loanHolding({ lenderName }),
    );

    expect(matches).toHaveLength(expected);
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
