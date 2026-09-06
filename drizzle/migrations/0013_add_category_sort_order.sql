/*
 Add `sort_order` to `categories` for the reorderable Categories list (drag +
 move-to-top/bottom), mirroring accounts/holdings' `sort_order`.

 The column is added defaulting to 0, so every existing row would share
 `sort_order = 0`. Backfill each row with a distinct, stable 0-based rank
 derived from its insertion order (`rowid`, which SQLite assigns monotonically),
 so the categories list renders in its existing display order on first launch
 instead of collapsing to an arbitrary tie. New rows are assigned
 `max(sort_order) + 1` by the repository, and a manual reorder overwrites these
 ranks. Same shape as 0006_backfill_sort_order (accounts/holdings).
*/
ALTER TABLE `categories` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `categories` SET `sort_order` = (SELECT COUNT(*) FROM `categories` AS `ranked` WHERE `ranked`.`rowid` < `categories`.`rowid`);
