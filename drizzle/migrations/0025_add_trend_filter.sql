ALTER TABLE `settings` ADD `trend_filter` text;--> statement-breakpoint
/*
 Migrate the legacy `trend_category_keys` (a JSON array of category slugs) into
 the richer `trend_filter` value. A non-null saved selection becomes an explicit
 manual filter `{ "mode": "manual", "keys": [...] }`; `json(...)` embeds the
 stored array as JSON rather than a quoted string. A NULL `trend_category_keys`
 is left untouched, so `trend_filter` stays NULL and the chart falls back to the
 default (top 3 by contribution). Idempotent and safe to re-run: it only writes
 rows whose `trend_category_keys` is non-null, and re-running rewrites the same
 value.
*/
UPDATE `settings` SET `trend_filter` = json_object('mode', 'manual', 'keys', json(`trend_category_keys`)) WHERE `trend_category_keys` IS NOT NULL;
