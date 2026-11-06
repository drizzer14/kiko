/*
 Add `settings.recurring_merchant_choices`: what the user chose for each merchant on the
 recurring-charges list, as one JSON map from the merchant key to its choice. NULL means nothing
 was chosen, which is every existing settings row, so there is no default and no step that fills
 it in.

 Crash-safe: additive only (one ADD COLUMN, no default, no index, no data copy), and the runner
 applies the statement and its bookkeeping row in ONE transaction, so a crash leaves the database
 at the previous index to retry whole on the next launch. The restore mirror is the column
 itself: a `.kiko` file from an older build has no such key, and the restore insert leaves it NULL.
*/
ALTER TABLE `settings` ADD `recurring_merchant_choices` text;
