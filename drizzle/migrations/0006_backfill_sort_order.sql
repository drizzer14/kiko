/*
 Backfill `sort_order` for the drag-and-drop reorder feature.

 The column has existed (defaulting to 0) since the initial schema, so every
 existing row currently shares `sort_order = 0`. Give each row a distinct,
 stable 0-based rank derived from its creation order (`rowid`, which SQLite
 assigns monotonically on insert), so the accounts grid and each account's
 holdings grid render in their existing display order on first launch instead
 of collapsing to an arbitrary tie. New rows are assigned `max(sort_order) + 1`
 by the repositories, and a manual reorder overwrites these ranks.
*/
UPDATE `accounts` SET `sort_order` = (SELECT COUNT(*) FROM `accounts` AS `ranked` WHERE `ranked`.`rowid` < `accounts`.`rowid`);--> statement-breakpoint
UPDATE `holdings` SET `sort_order` = (SELECT COUNT(*) FROM `holdings` AS `ranked` WHERE `ranked`.`rowid` < `holdings`.`rowid`);
