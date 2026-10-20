/*
 Add `transactions.operation`: the label of an exchange operation (a trade, its fee, a convert, a
 dust sweep, a P2P purchase, a card purchase, a fiat deposit or withdrawal). It is written once on
 insert and only picks the label shown at render time; statistics never read it, since exclusion
 stays on the stored markers (`exchange_counterpart_holding_id`, `exchange_pair_id`,
 `untracked_counterpart`). Null on every row that is no exchange operation.

 Crash-safe: additive only (one ADD COLUMN, no index, no backfill, no data copy), and the runner
 applies the statement and its bookkeeping row in ONE transaction, so a crash leaves the database
 at 0062 to retry whole on the next launch. The restore mirror is the nullable column itself: a
 `.kiko` file from an older build has no `operation` key, and the restore insert fills it with
 null.
*/
ALTER TABLE `transactions` ADD `operation` text;
