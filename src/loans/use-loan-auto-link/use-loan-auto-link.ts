import { holdingsRepo } from '@kiko/holdings/repo';
import { transactionsRepo } from '@kiko/transactions/repo';

import { matchLoanPayments } from '../payment-matcher';

const warnLoanAutoLinkFailure = (reason: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) a failed loan-payment auto-link has no UI surface of its own — log it so a device log shows what silently failed; the next sync/import retries it, same precedent as refresh-market-data.ts's warnRefreshFailure.
  console.warn('[loan-auto-link] failed', reason);
};

/**
 * Runs the loan-payment auto-link matcher (`src/loans/payment-matcher/`)
 * against the CURRENT database state and writes any resulting links through
 * `transactionsRepo.setAutoLoanLinks` — the entry point every sync surface,
 * every `importParsedStatement` caller, and a loan create/edit call after
 * their own write commits (mirrors `refreshMarketData`'s own reach). A plain
 * async function, not a React hook, precisely so it. can be called from those
 * non-component call sites too (`import-statement.ts`,
 * `apply-column-mapping.ts`'s caller) as freely as from a screen's own event
 * handler.
 *
 * Reads `holdingsRepo.loanHoldingsQuery()` FIRST and returns before ever
 * touching the (larger) transaction table when it is empty — a user with no
 * debts costs this call one cheap query, never a transaction scan
 * (P-NOWORK). Never rejects: every failure (a read, or the write) is caught
 * and logged, the same "log instead of drop" contract
 * `refresh-market-data.ts` already established for its own background
 * refreshes — a failed auto-link must never turn a successful sync/import/
 * save into a shown error.
 *
 * `now` defaults to the real current time; a caller (this module's own test)
 * may pass a fixed instant so the matcher's own day-window math is
 * deterministic.
 */
export const runLoanAutoLink = async (now: number = Date.now()): Promise<void> => {
  try {
    const loanHoldingRows = await holdingsRepo.loanHoldingsQuery();

    if (loanHoldingRows.length === 0) {
      return;
    }

    const candidateRows = await transactionsRepo.loanMatchCandidatesQuery();

    if (candidateRows.length === 0) {
      return;
    }

    // `loanMatchCandidatesQuery` already filters to a row with no link, no
    // rejection, and no exchange marker — these three are hardcoded to the
    // value that filter already guarantees, not re-read, so the matcher's own
    // defensive checks always pass without a redundant projection.
    const matches = matchLoanPayments({
      transactions: candidateRows.map((row) => ({
        ...row,
        loanHoldingId: null,
        loanLinkRejected: false,
        exchangeCounterpartHoldingId: null,
      })),
      loans: loanHoldingRows,
      now,
    });

    if (matches.length === 0) {
      return;
    }

    await transactionsRepo.setAutoLoanLinks(
      matches.map((match) => ({
        transactionId: match.transactionId,
        loanHoldingId: match.loanHoldingId,
      })),
    );
  } catch (error) {
    warnLoanAutoLinkFailure(error);
  }
};
