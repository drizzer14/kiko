/*
 Adds the one-shot flag `MigrationsGate` runs its statement-import time
 rezone under (`statement-import/rezone-import-times/`'s
 `planImportTimeRezone`). The rewrite itself is NOT SQL: the device's own
 local-time reading and the dedup-key format live only in JS, so the
 rewrite has to run as a pure JS pass over the stored rows, once, after this
 column exists. Defaults to `false` (unrun); the launch step flips it to
 `true` after the one-time rewrite completes, mirroring the `false`-until-run
 shape of `dedup_keys_upgraded` (migration 0041).
*/
ALTER TABLE `settings` ADD `import_times_rezoned` integer DEFAULT false NOT NULL;
