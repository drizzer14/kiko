/*
 Add an index on `transactions.loan_holding_id`: the loan-linked payments lookup
 (`transactionsRepo.loanLinkedPaymentsQuery`, `transactions/repo/transactions.repo.ts`)
 filters by it with `inArray`, and the matcher filters on `isNull(loanHoldingId)`,
 so each read scanned the whole table without it.

 Crash-safe: additive only, and the runner applies the statement and its
 bookkeeping row in ONE transaction, so a crash leaves the database at 0052 to
 retry whole on the next launch. An index carries no data, so a restore needs
 no mirror.
*/
CREATE INDEX `transactions_loan_holding_id` ON `transactions` (`loan_holding_id`);
