/*
 Add an index on `transactions.loan_holding_id` for the lookups that name a
 loan holding: the loan-linked payments read
 (`transactionsRepo.loanLinkedPaymentsQuery`, `transactions/repo/transactions.repo.ts`)
 filters by it with `inArray`, and any `=` or `IS NOT NULL` lookup by loan
 holding uses it too, so each read no longer scans the whole table.

 Partial (`WHERE loan_holding_id IS NOT NULL`), so it holds only the linked
 rows and stays small, and the loan matcher's own `loan_holding_id IS NULL`
 filter cannot use it: the matcher keeps its `transactions_time` window index
 instead of reading nearly every row through a full index on the NULLs.

 Crash-safe: additive only, and the runner applies the statement and its
 bookkeeping row in ONE transaction, so a crash leaves the database at 0052 to
 retry whole on the next launch. An index carries no data, so a restore needs
 no mirror.
*/
CREATE INDEX `transactions_loan_holding_id` ON `transactions` (`loan_holding_id`) WHERE "transactions"."loan_holding_id" IS NOT NULL;
