/*
 Lowercase every stored category value to the `categories.key` slug convention.

 `src/monobank/mcc-category.ts` used to persist a capitalized display name
 ('Groceries', 'Dining', 'Other') into `transactions.category`, while every
 other writer — the seed in 0002, `categoryOverridesRepo`, and the transaction
 form — persists the lowercase slug. Neither column is COLLATE NOCASE, so a
 capitalized value never matched `categoriesRepo.delete`'s reassignment
 predicate and stayed orphaned on a deleted category slug.

 `categoryForMcc` now emits the slug, so this one-time pass folds every legacy
 row onto the same convention. `lower()` is a no-op on a value that is already
 lowercase, so this is idempotent and safe to re-run. `categories.key` itself
 is untouched — it has always been the lowercase slug.
*/
UPDATE `transactions` SET `category` = lower(`category`) WHERE `category` IS NOT NULL AND `category` <> lower(`category`);--> statement-breakpoint
UPDATE `category_overrides` SET `category` = lower(`category`) WHERE `category` <> lower(`category`);
