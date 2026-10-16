/*
 Add `settings.history_backfill_cursor`: the code of the first crypto coin whose history request
 failed in the last backfill run, or NULL when none did. The next run starts requesting there,
 so a burst limit that cuts a run short cannot keep the same coins waiting.

 Crash-safe: additive only (one ADD COLUMN, no index, no backfill, no data copy), and the runner
 applies the statement and its bookkeeping row in ONE transaction, so a crash leaves the database
 one step back to retry whole on the next launch. The cursor belongs to this device: a restore
 keeps the live value and ignores the file's, so there is nothing to mirror, and a file from an
 older build, which has no `historyBackfillCursor` key, restores the same.
*/
ALTER TABLE `settings` ADD `history_backfill_cursor` text;
