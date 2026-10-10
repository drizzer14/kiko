/*
 Add `transactions.untracked_counterpart`: the code `wallet:<TYPE>` of a Binance
 move whose other side is a wallet Kiko does not track (Futures, Margin, Options,
 Portfolio Margin). Such a move has one leg only, so no second row can pair with it;
 this column is the stored marker that keeps the leg out of spending and lets the
 label be resolved at render time.

 Crash-safe: additive only (one ADD COLUMN, no index, no backfill, no data copy), and
 the runner applies the statement and its bookkeeping row in ONE transaction, so a
 crash leaves the database at 0055 to retry whole on the next launch. The restore
 mirror is the nullable column itself: a `.kiko` file from an older build has no
 `untrackedCounterpart` key, and the restore insert fills it with null.
*/
ALTER TABLE `transactions` ADD `untracked_counterpart` text;
