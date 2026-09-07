/*
 Default category colors + one icon refinement.

 0002 seeds the ten categories with a null `color` and seeds `transport`
 with the `car` icon. This migration paints the eight categories that have
 a settled color with the hex of their `entityColors` token (see
 src/design-system/theme.ts — the token name precedes each UPDATE below)
 and refines the `transport` icon from `car` to `bus`.

 Each UPDATE is guarded so it only touches a row that still holds the
 seeded default (`color IS NULL`, or `icon = 'car'` for transport): this
 converges both a fresh install (seeded by 0002 with a null color and the
 `car` icon) and a database upgraded from the old app, while preserving any
 color or icon a user picked themselves. `utilities` and `entertainment`
 are intentionally left uncolored (null), and only `transport`'s icon
 changes. Data-only migration (no schema change), so it is hand-authored
 and carries no meta snapshot — same shape as 0006_backfill_sort_order.
*/
-- entityColors.green
UPDATE `categories` SET `color` = '#30D158' WHERE `key` = 'groceries' AND `color` IS NULL;--> statement-breakpoint
-- entityColors.orange
UPDATE `categories` SET `color` = '#FF9F0A' WHERE `key` = 'dining' AND `color` IS NULL;--> statement-breakpoint
-- entityColors.blue
UPDATE `categories` SET `color` = '#0A84FF' WHERE `key` = 'transport' AND `color` IS NULL;--> statement-breakpoint
-- entityColors.pink
UPDATE `categories` SET `color` = '#FF375F' WHERE `key` = 'shopping' AND `color` IS NULL;--> statement-breakpoint
-- entityColors.red
UPDATE `categories` SET `color` = '#FF453A' WHERE `key` = 'health' AND `color` IS NULL;--> statement-breakpoint
-- entityColors.khaki
UPDATE `categories` SET `color` = '#BDB76B' WHERE `key` = 'cash' AND `color` IS NULL;--> statement-breakpoint
-- entityColors.white
UPDATE `categories` SET `color` = '#FFFFFF' WHERE `key` = 'transfers' AND `color` IS NULL;--> statement-breakpoint
-- entityColors.gray
UPDATE `categories` SET `color` = '#98989D' WHERE `key` = 'other' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `icon` = 'bus' WHERE `key` = 'transport' AND `icon` = 'car';
