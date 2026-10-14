/*
 Replace `category_overrides` with `category_rules`, and add `transactions.category_set_by_hand`,
 the mark on a row whose category the user picked by hand (no rule and no rewrite replaces it).

 Every override becomes exactly one rule with the same category and timestamps: one `nameIs`
 matcher whose text is the override's `display_name` (by construction, normalizing it gives back
 the override's `normalized_name`), under a fresh random id. An override whose `display_name` is
 blank becomes a rule that fails the read-time guard; it is stored, never matches, and shows as
 unreadable, so no override is lost here. Every existing transaction gets 0 in the new column.

 Crash-safe: the order is create, COPY, then DROP, and the runner applies every statement and its
 bookkeeping row in ONE transaction, so a crash leaves the database at the previous migration with
 the overrides intact to retry whole on the next launch. Never move the DROP before the copy.
*/
CREATE TABLE `category_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`matchers` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `category_rules` (`id`, `category`, `matchers`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `category`, json_array(json_object('type', 'nameIs', 'text', `display_name`)), `created_at`, `updated_at`
FROM `category_overrides`;--> statement-breakpoint
ALTER TABLE `transactions` ADD `category_set_by_hand` integer DEFAULT false NOT NULL;--> statement-breakpoint
DROP TABLE `category_overrides`;
