/*
 Add `transactions.sets_balance`: the stored mark on the ONE row whose amount
 set its holding's balance at `holdings.balance_set_at` (an opening balance, a
 cash opening, a hand balance edit). `transactionsRepo.update`/`remove`
 (`transactions/repo/transactions.repo.ts`) read it to keep that row's rule
 after a re-date, a description, or a category, none of which its time or
 its shape survives.

 Backfill: the row of each holding that is BOTH shaped like a balance-set row
 (manual, `description ''`, `category` NULL, no exchange-leg or change-return
 marker — `isBalanceSetShapedRow`, `transactions/balance-set-row/`) AND dated
 exactly at that holding's `balance_set_at` — the identity
 `transactionsRepo.update` used before this column. A row a closing-balance
 import anchors matches neither (no row is written at a closing balance's
 as-of), and a row an earlier balance set wrote sits before the newer
 anchor, so at most the newest set's row is marked.

 Two rows of one holding can qualify only when they share the same
 millisecond, and then nothing stored tells them apart but the id. The
 smallest id wins: `restoreDataSnapshot`
 (`data-transfer/snapshot/restore-snapshot.ts`) derives the same mark for a
 `.kiko` file exported before this column, and a restore keeps every id but
 not the insertion order.

 Crash-safe: additive only (a new column, then marks), and the runner applies
 both statements and its bookkeeping row in ONE transaction, so a crash
 leaves the database at 0046 to retry whole on the next launch.
*/
ALTER TABLE `transactions` ADD `sets_balance` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `transactions` SET `sets_balance` = true
WHERE `id` IN (
  SELECT MIN(`transactions`.`id`) FROM `transactions`
  INNER JOIN `holdings` ON `holdings`.`id` = `transactions`.`holding_id`
  WHERE `transactions`.`time` = `holdings`.`balance_set_at`
    AND `transactions`.`source` = 'manual'
    AND `transactions`.`description` = ''
    AND `transactions`.`category` IS NULL
    AND `transactions`.`exchange_counterpart_holding_id` IS NULL
    AND `transactions`.`change_group_id` IS NULL
  GROUP BY `transactions`.`holding_id`
);
