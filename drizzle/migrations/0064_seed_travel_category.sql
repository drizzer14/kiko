/*
 Seeds the twelfth default category, `travel` — hotels, travel agencies, airlines and airports map
 to it (`ADDED_MCC_CATEGORIES` in `src/monobank/mcc-category/mcc-category.ts`).
 `INSERT OR IGNORE` keeps it idempotent and never overwrites, retitles or recolors a row already
 holding the key; `sort_order` appends after every existing one (mirrors `accountsRepo`'s
 "max + 1" convention), even a reordered list, so no other row's order changes.
 The color is the literal dark-palette hex of `entityColorsDark.teal`, as every seeded row stores
 a hex and not a token name.
*/
INSERT OR IGNORE INTO `categories` (`key`, `title`, `icon`, `color`, `sort_order`) VALUES ('travel', 'Travel', 'airplane', '#40C8E0', (SELECT COALESCE(MAX(`sort_order`), -1) + 1 FROM `categories`));
