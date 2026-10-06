/*
 Add the table of deleted import keys: one row (holding, stored `external_id`) per
 statement-import row the user deleted. A re-import that brings such a row back
 counts its full amount (the delete reversed it), while a row the holding never
 had stays history and counts 0, so a first import of past months never
 double-counts (`transactionsRepo.importRows`, kiko-statement-import).

 The composite primary key is the only index: its leading `holding_id` serves the
 holding delete and the import read, so no named index joins the shared index
 namespace. The foreign key is NO ACTION like every other: a holding delete
 removes its keys first (`removeHoldingDatabaseTransaction`).

 Crash-safe: additive only (one new table, no data written), and the runner
 applies the statement and its bookkeeping row in ONE transaction, so a crash
 leaves the database at 0053 to retry whole on the next launch. No backfill: a
 delete made before this migration left no key and cannot be known, the same on a
 live device and on a restore of an older file (that restore leaves the table
 empty), so a re-import of such a row comes back at 0 as it did before. The
 restore mirror is the table itself (`restore-snapshot.ts`, inserted after the
 holdings).
*/
CREATE TABLE `deleted_import_keys` (
	`holding_id` text NOT NULL,
	`external_id` text NOT NULL,
	`deleted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`holding_id`, `external_id`),
	FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE no action
);
