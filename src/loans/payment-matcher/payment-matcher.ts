import { DAY_MS } from '@kiko/dates';
import {
  isScheduledPayment,
  loanInstallments,
  withinInstallmentTolerance,
} from '@kiko/holdings/loan-schedule';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { dayKeyOf } from '@kiko/prices/price-book';
import type { Currency } from '@kiko/currency/currency';
import { asLoanMeta, type LoanMeta } from '@kiko/holdings/holding-metadata';

// Exported so `use-loan-auto-link.ts` can derive its own SQL-level lower
// bound ("earliest loan start minus the window's own before-margin") from
// the SAME constant this module's own date-window check uses, rather than
// a second, driftable literal.
// A payment matches from 3 days before to 7 days after the due date.
export const WINDOW_BEFORE_DAYS = 3;
const WINDOW_AFTER_DAYS = 7;

// A fixed keyword list (Ukrainian + English), checked
// case-insensitively against the transaction's own description. The
// lender's own name is a SEPARATE, per-loan signal (not a literal here) —
// see `hasThirdSignal` below.
const PAYMENT_KEYWORDS = [
  'кредит',
  'погашення',
  'іпотек',
  'позик',
  'loan',
  'mortgage',
  'repayment',
];

// A lenderName shorter than this is too likely to appear inside an
// unrelated description by coincidence (e.g. "Jo" inside "Joe's Diner") to
// count as a real third signal.
const MIN_LENDER_NAME_LENGTH = 3;

/**
 * Strips whitespace (including the grouping spaces a user or a bank
 * feed may insert every 4 characters) and uppercases, so a cosmetic
 * difference between what the user typed on the loan form and what a bank's
 * own `counterIban` carries never false-negatives rule 3's IBAN signal.
 * Exported so the loan form's own save path (`use-loan-fields.ts`) can
 * persist an already-normalized `lenderIban`, rather than duplicating this
 * logic in a second place.
 */
export const normalizeIban = (value: string): string => value.replace(/\s+/g, '').toUpperCase();

/** A loan holding as the matcher needs it — mirrors `loan-payments.ts`'s
 * `LoanHolding`, parsing `LoanMeta` internally so a caller hands it plain
 * holding rows straight off `holdingsRepo.loanHoldingsQuery()`, with no
 * intermediate mapping step of its own. */
type MatchableLoanHolding = Pick<HoldingRow, 'id' | 'currency' | 'metadata'>;

/**
 * One transaction ALREADY linked (manual or auto alike) to a loan — the
 * matcher's own "taken installment" input. `loanMatchCandidatesQuery`
 * excludes an already-linked row from `transactions` (P-NOWORK: never hand
 * the matcher a row it can never (re-)link), so without this separate list
 * the installment that row already paid would look UNPAID on the very next
 * run, and a later same-amount transaction (a same-size monthly rent, say)
 * could take its place — double-counting one installment across two real
 * payments. `loanHoldingId: string | null` mirrors the raw stored column
 * (nullable in the schema) rather than a narrowed `string` — every row this
 * type actually describes carries a real loan id, but no unsafe cast is
 * needed to say so: `string | null` still compares correctly against a
 * `CandidateInstallment`'s own (never-null) `loanHoldingId`.
 */
export type LinkedLoanPayment = {
  loanHoldingId: string | null;
  amountMinorUnits: number;
  time: number;
};

/** A transaction as the matcher needs it: every column its own candidate
 * filter (an eligible debit) and its third signal (rule 3) read. */
export type MatchableTransaction = {
  id: string;
  holdingId: string;
  currency: Currency;
  amountMinorUnits: number;
  time: number;
  description: string;
  counterIban: string | null;
  loanHoldingId: string | null;
  loanLinkRejected: boolean;
  exchangeCounterpartHoldingId: string | null;
  untrackedCounterpart: string | null;
};

type LoanPaymentMatch = {
  transactionId: string;
  loanHoldingId: string;
  dueDate: number;
};

// Rule-4's candidate filter: a debit, never already linked or already
// rejected (a manual "None" or Undo must stick — kiko-domain), never one leg
// of an Exchange/Convert, and never a move to an untracked Binance wallet
// (structural markers, not a description guess — see `exchange-exclusion.ts`'s
// identical checks).
const isEligibleTransaction = (transaction: MatchableTransaction): boolean =>
  transaction.amountMinorUnits < 0 &&
  transaction.loanHoldingId === null &&
  !transaction.loanLinkRejected &&
  transaction.exchangeCounterpartHoldingId === null &&
  transaction.untrackedCounterpart === null;

// Rule 2: the transaction's own LOCAL day, 3 days before to 7 days after the
// due date's local day — both bounds inclusive, the same "both bounds
// inclusive" idiom `loanInterestPerPaymentMinor` already establishes.
const withinDateWindow = (transactionTime: number, dueDate: number): boolean => {
  const dayDiff = (dayKeyOf(transactionTime) - dayKeyOf(dueDate)) / DAY_MS;

  return dayDiff >= -WINDOW_BEFORE_DAYS && dayDiff <= WINDOW_AFTER_DAYS;
};

// One loan's own installment, carrying back the per-loan fields rule 3 needs
// (`paymentHoldingId`/`lenderName`/`lenderIban`) — built once per loan so the
// O(installments x transactions) pass below never re-parses `LoanMeta` or
// re-derives them per pair.
type CandidateInstallment = {
  loanHoldingId: string;
  currency: Currency;
  dueDate: number;
  paymentMinorUnits: number;
  paymentHoldingId: string | undefined;
  lenderName: string | undefined;
  lenderIban: string | undefined;
};

// Rule 3: at least one more signal beyond amount+date — the loan's own
// `paymentHoldingId`, `lenderIban` against the transaction's `counterIban`,
// or a keyword/the lender's own name in the description (both
// case-insensitive). Amount + date ALONE (e.g. a same-size monthly rent)
// never links — this is what stops that false positive.
const hasThirdSignal = (
  transaction: MatchableTransaction,
  installment: CandidateInstallment,
): boolean => {
  if (
    installment.paymentHoldingId !== undefined &&
    transaction.holdingId === installment.paymentHoldingId
  ) {
    return true;
  }

  if (
    installment.lenderIban !== undefined &&
    transaction.counterIban !== null &&
    normalizeIban(transaction.counterIban) === normalizeIban(installment.lenderIban)
  ) {
    return true;
  }

  const description = transaction.description.toLowerCase();

  if (PAYMENT_KEYWORDS.some((keyword) => description.includes(keyword))) {
    return true;
  }

  return (
    installment.lenderName !== undefined &&
    installment.lenderName.trim().length >= MIN_LENDER_NAME_LENGTH &&
    description.includes(installment.lenderName.toLowerCase())
  );
};

// An installment already paid by a linked row (manual or auto) must never
// be handed to a DIFFERENT, later transaction — `linkedPayments`
// carries every row already linked to each loan, and an installment counts
// as taken the moment ANY of them still passes rules 1 (amount) and 2 (date)
// for it. The third signal is deliberately NOT re-checked here: the link
// itself already proved it once, and re-checking it against `linkedPayments`
// (which carries no description/holdingId/counterIban) is not even possible.
const installmentIsTaken = (
  installment: CandidateInstallment,
  linkedPayments: readonly LinkedLoanPayment[],
): boolean =>
  linkedPayments.some(
    (payment) =>
      payment.loanHoldingId === installment.loanHoldingId &&
      withinInstallmentTolerance(
        installment.paymentMinorUnits,
        Math.abs(payment.amountMinorUnits),
        installment.currency,
      ) &&
      withinDateWindow(payment.time, installment.dueDate),
  );

// Every installment due on or before `now` (plus the window's own
// before-margin, so a payment already made a few days ahead of an upcoming
// due date still matches) — a cheap UPPER bound only, never a lower one:
// every past installment stays candidate, so a freshly created/edited loan
// backfills its whole history the first time this runs. `'none'`
// (informal) loans have no installments at all (`loanInstallments` already
// returns `[]` for them), so they never produce a candidate here — no
// separate schedule check is needed.
const candidateInstallmentsFor = (
  loan: MatchableLoanHolding,
  meta: LoanMeta,
  now: number,
): CandidateInstallment[] => {
  const cutoffDayKey = dayKeyOf(now) + WINDOW_BEFORE_DAYS * DAY_MS;

  return loanInstallments(meta)
    .filter(isScheduledPayment)
    .filter((installment) => dayKeyOf(installment.dueDate) <= cutoffDayKey)
    .map((installment) => ({
      loanHoldingId: loan.id,
      currency: loan.currency,
      dueDate: installment.dueDate,
      paymentMinorUnits: installment.paymentMinorUnits,
      paymentHoldingId: meta.paymentHoldingId,
      lenderName: meta.lenderName,
      lenderIban: meta.lenderIban,
    }));
};

const installmentKey = (installment: CandidateInstallment): string =>
  `${installment.loanHoldingId}:${installment.dueDate}`;

/**
 * The auto-link matcher: a pure, idempotent function from every candidate
 * transaction + every loan's own schedule to the links that
 * should be written with `source: 'auto'` (`transactionsRepo.setAutoLoanLinks`
 * is the ONLY write path for what this returns — see that function's own doc
 * comment). Never mutates anything itself; a caller re-running it against
 * already-linked data (its own `MatchableTransaction.loanHoldingId` is not
 * `null`) simply excludes that row from `isEligibleTransaction`, so a re-run
 * is naturally idempotent.
 *
 * Rule 4 (uniqueness) is checked over the FULL candidate matrix, not a
 * sequential filter: an installment with more than one matching transaction,
 * or a transaction that matches more than one installment (of the SAME or a
 * DIFFERENT loan), is excluded from BOTH ends — order-independent, so it
 * matches the spec's own "exactly one candidate for the installment, and the
 * candidate matches exactly one installment of one loan" regardless of which
 * ambiguity is checked first.
 */
export const matchLoanPayments = (params: {
  transactions: readonly MatchableTransaction[];
  loans: readonly MatchableLoanHolding[];
  // Every row already linked (manual or auto) to one of `loans` — the
  // "taken installment" input (see `installmentIsTaken`'s own doc comment).
  // Optional, defaulting to none, so an existing caller that has no such
  // list yet (or a test not exercising this path) keeps its prior behavior
  // unchanged.
  linkedPayments?: readonly LinkedLoanPayment[];
  now: number;
}): LoanPaymentMatch[] => {
  const { transactions, loans, linkedPayments = [], now } = params;

  const candidates = transactions.filter(isEligibleTransaction);
  const everyInstallment = loans.flatMap(
    (loan) =>
      foldMap(maybe(asLoanMeta(loan.metadata)), (meta) =>
        candidateInstallmentsFor(loan, meta, now),
      ) ?? [],
  );
  const installments = everyInstallment.filter(
    (installment) => !installmentIsTaken(installment, linkedPayments),
  );

  const pairs: { transactionId: string; installment: CandidateInstallment }[] = [];

  for (const transaction of candidates) {
    for (const installment of installments) {
      if (
        transaction.currency === installment.currency &&
        withinInstallmentTolerance(
          installment.paymentMinorUnits,
          Math.abs(transaction.amountMinorUnits),
          installment.currency,
        ) &&
        withinDateWindow(transaction.time, installment.dueDate) &&
        hasThirdSignal(transaction, installment)
      ) {
        pairs.push({ transactionId: transaction.id, installment });
      }
    }
  }

  const installmentCounts = new Map<string, number>();
  const transactionCounts = new Map<string, number>();

  for (const pair of pairs) {
    const key = installmentKey(pair.installment);
    installmentCounts.set(key, (installmentCounts.get(key) ?? 0) + 1);
    transactionCounts.set(pair.transactionId, (transactionCounts.get(pair.transactionId) ?? 0) + 1);
  }

  return pairs
    .filter(
      (pair) =>
        installmentCounts.get(installmentKey(pair.installment)) === 1 &&
        transactionCounts.get(pair.transactionId) === 1,
    )
    .map((pair) => ({
      transactionId: pair.transactionId,
      loanHoldingId: pair.installment.loanHoldingId,
      dueDate: pair.installment.dueDate,
    }));
};
