/*
 Give each of the ten seeded categories an explicit, distinct color.

 With `categories.color` null, the chart layer falls back to `categoryColor`
 (statistics/category-breakdown.ts) — a hash of the key over the 8-entry
 `chartSeries` palette. Over these exact ten keys that hash collapses to FIVE
 distinct hues: shopping/entertainment/transfers/other all render #0A84FF (four
 identical blue donut wedges), dining/transport both #30D158, groceries/cash
 both #BF5AF2. `resolveCategoryColor` prefers a STORED color over the hash, so
 seeding one per category fixes the donut, the Home filter chips and the
 category-row icons at once, with no code change.

 Every value is a `theme.colors.entityColors` member (src/design-system/theme.ts),
 so a category swatch reads as the same family as every account/holding swatch.
 Only a category whose color is still NULL is touched, so a user who has
 already picked a color keeps it, and re-running is a no-op.
*/
UPDATE `categories` SET `color` = '#30D158' WHERE `key` = 'groceries' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#FF9F0A' WHERE `key` = 'dining' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#0A84FF' WHERE `key` = 'transport' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#BF5AF2' WHERE `key` = 'shopping' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#FFD60A' WHERE `key` = 'utilities' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#FF375F' WHERE `key` = 'entertainment' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#FF453A' WHERE `key` = 'health' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#66D4CF' WHERE `key` = 'cash' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#5E5CE6' WHERE `key` = 'transfers' AND `color` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color` = '#98989D' WHERE `key` = 'other' AND `color` IS NULL;
