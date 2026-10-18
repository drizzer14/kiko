/*
 Add `settings.history_backfill_state`: what the history backfill keeps between launches, as text.
 It holds the code of the first crypto coin CoinGecko rate-limited in the last run, where the next
 run starts requesting, so a burst limit that cuts a run short cannot keep the same coins waiting;
 and, per currency, the span start a fetch began from without finding an earlier day, so the same
 question is not asked again on every launch.

 Crash-safe: additive only (one ADD COLUMN, no index, no backfill, no data copy), and the runner
 applies the statement and its bookkeeping row in ONE transaction, so a crash leaves the database
 one step back to retry whole on the next launch. The state belongs to this device: a restore
 keeps the live value and ignores the file's, so there is nothing to mirror, and a file from an
 older build, which has no `historyBackfillState` key, restores the same.
*/
ALTER TABLE `settings` ADD `history_backfill_state` text;
