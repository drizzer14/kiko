/*
 Add `settings.dismissed_tips`: the ids of the first-time tips the user dismissed,
 as a JSON list. A tip shows until its id is in the list; "Show tips again" only
 clears the list, so there is no global "hide all tips" flag.

 Crash-safe: additive only (one ADD COLUMN, no data copy), and the runner applies
 the statement and its bookkeeping row in ONE transaction, so a crash leaves the
 database at 0054 to retry whole on the next launch. The restore mirror is the
 schema default: a file from an older build has no `dismissedTips` key, and the
 restore insert fills it with `[]`.
*/
ALTER TABLE `settings` ADD `dismissed_tips` text DEFAULT '[]' NOT NULL;
