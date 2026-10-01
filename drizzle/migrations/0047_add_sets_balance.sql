/*
 Add `transactions.sets_balance`, the stored mark on every row whose amount
 set its holding's balance (an opening balance, a cash opening, a hand
 balance edit), and `holdings.balance_set_row_id`, the one such row whose set
 is the holding's current balance (NULL when a closing-balance import set it,
 since that writes no row). `transactionsRepo.update`/`remove`
 (`transactions/repo/transactions.repo.ts`) read both: a re-date or a delete
 of a marked row never moves the balance, whatever its time or shape has
 become, and only an amount edit of the current row does.

 Backfill: the current row of each holding is the row that is BOTH shaped
 like a balance-set row (manual, `description ''`, `category` NULL, no
 exchange-leg or change-return marker — `isBalanceSetShapedRow`,
 `transactions/balance-set-row/`) AND dated exactly at that holding's
 `balance_set_at`, and that row alone is marked. A closing-balance anchor
 has no such row, and a row an earlier balance set wrote sits before the
 newer anchor, so neither is marked.

 Two rows of one holding can qualify only when they share the same
 millisecond, and then nothing stored tells them apart but the id. The
 smallest id wins: `restoreDataSnapshot`
 (`data-transfer/snapshot/restore-snapshot.ts`) derives the same marks for a
 `.kiko` file exported before these columns, and a restore keeps every id
 but not the insertion order.

 Crash-safe: additive only (two new columns, then the backfill), and the
 runner applies every statement and its bookkeeping row in ONE transaction,
 so a crash leaves the database at 0046 to retry whole on the next launch.
*/
ALTER TABLE `holdings` ADD `balance_set_row_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `sets_balance` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `holdings` SET `balance_set_row_id` = (
  SELECT MIN(`transactions`.`id`) FROM `transactions`
  WHERE `transactions`.`holding_id` = `holdings`.`id`
    AND `transactions`.`time` = `holdings`.`balance_set_at`
    AND `transactions`.`source` = 'manual'
    AND `transactions`.`description` = ''
    AND `transactions`.`category` IS NULL
    AND `transactions`.`exchange_counterpart_holding_id` IS NULL
    AND `transactions`.`change_group_id` IS NULL
);--> statement-breakpoint
UPDATE `transactions` SET `sets_balance` = true
WHERE `id` IN (
  SELECT `balance_set_row_id` FROM `holdings` WHERE `balance_set_row_id` IS NOT NULL
);
