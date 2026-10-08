/*
 Add `balance_set_at` (the statement-import boundary — see
 `transactionsRepo.importRows`'s own doc comment, `transactions/repo/transactions.repo.ts`,
 for the full rule) and backfill it for holdings that already have a
 hand-set balance in their ledger.

 Going forward, `balance_set_at` is written directly by the three code paths
 that set (not move) a balance: `holdingsRepo.create` (a non-zero typed
 opening balance), `holdingsRepo.updateWithBalanceDelta` (a non-zero balance
 edit), and `transactionsRepo.importRows`'s own closing-balance write. None
 of those existed before this migration, so a pre-migration holding's
 hand-set balance has no direct signal — only a `source = 'manual'`
 transaction row that HAPPENS to carry the same shape `holdingsRepo.create`/
 `updateWithBalanceDelta` write (`description ''`, `category` NULL, no
 exchange-leg marker, no change-return marker). This is a HEURISTIC for
 backfilling PRE-migration data only: a coincidentally-shaped manual row
 (unlikely, since `recordManual`/exchange legs/change returns each carry a
 description, a category, or one of the two structural markers) would
 backfill a false boundary, and a genuinely hand-set balance whose manual
 row was later edited to carry a description or category would backfill
 none. Neither case existed before this migration (I3: 1.0.0 unpublished),
 so this is a one-time best-effort seed, not a repair.
*/
ALTER TABLE `holdings` ADD `balance_set_at` integer;--> statement-breakpoint
UPDATE `holdings` SET `balance_set_at` = (
  SELECT MAX(`transactions`.`time`) FROM `transactions`
  WHERE `transactions`.`holding_id` = `holdings`.`id`
    AND `transactions`.`source` = 'manual'
    AND `transactions`.`description` = ''
    AND `transactions`.`category` IS NULL
    AND `transactions`.`exchange_counterpart_holding_id` IS NULL
    AND `transactions`.`change_group_id` IS NULL
);
