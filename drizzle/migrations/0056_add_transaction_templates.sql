/*
 Add the table of transaction templates: one row (id, name, draft) per saved
 transaction form. `draft` is the JSON of the fields the form fills from the
 template; the repo narrows it on read.

 Numbering: this file was generated as 0056 because the other track's 0056 is not
 yet merged, and it is renumbered to 0057 (file, snapshot, journal idx and test)
 at merge, after that 0056.

 No foreign key and no index: the holding and category ids live inside
 `draft` and a delete clears them there, and the table is small and read by its
 primary key or in full, so no named index joins the shared index namespace.

 Crash-safe: additive only (one new table, no data written), and the runner
 applies the statement and its bookkeeping row in ONE transaction, so a crash
 leaves the database at the previous idx to retry whole on the next launch. No
 data step, and no restore mirror beyond the table itself (`restore-snapshot.ts`):
 an older file carries no `transactionTemplates` key and restores an empty table.
*/
CREATE TABLE `transaction_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`draft` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
