/*
 Add `settings.mcc_categories_backfilled`: the once-only mark the app-open MCC back-fill runs under
 (`backfillMccCategories`, `src/categories/category-rules-repo/`). The back-fill moves an old row
 with a newly mapped MCC code to that code's category, in the same transaction that sets the
 mark, so a later open never repeats it. The mark is `false` (unrun) on every existing settings
 row. Its presence in a `.kiko` file also tells a file this build wrote from an older one.

 Crash-safe: additive only (one ADD COLUMN with a default, no index, no data copy), and the runner
 applies the statement and its bookkeeping row in ONE transaction, so a crash leaves the database
 at the previous index to retry whole on the next launch. The restore mirror is the default
 itself: a `.kiko` file from an older build has no such key, and the restore insert fills it with
 `false`, so the back-fill runs on it.
*/
ALTER TABLE `settings` ADD `mcc_categories_backfilled` integer DEFAULT false NOT NULL;
