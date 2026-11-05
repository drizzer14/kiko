/*
 Add the table `funding_match_rows`: the stored set of paired ledger rows of an exchange account,
 one row per ledger row and per source (`side`), read by account. It is created EMPTY and with its
 final columns, because a column added later is a second migration: no writer exists in this
 build, and a later release writes it with no migration of its own, so every build's journal is a
 prefix of the one that follows it (the runner applies `journal.slice(COUNT)`, and a phone with
 real data must never run a migration a later build does not hold).

 The composite primary key is the only index: its leading `account_id` serves the read, the prune
 and the clear of one account's rows, so no named index joins the shared index namespace. The
 foreign key is NO ACTION like every other: an account delete (`accountsRepo.remove`) and an
 exchange disconnect (`accountsRepo.disconnectExchange`) clear the account's rows first, and the
 restore deletes the table before `accounts`.

 Crash-safe: additive only (one new table, no data written, no backfill), and the runner applies
 the statement and its bookkeeping row in ONE transaction, so a crash leaves the database at 0065
 to retry whole on the next launch. The restore mirror is the table itself (`restore-snapshot.ts`):
 an optional `fundingMatchRows` key, read defensively, so a `.kiko` file from an older build
 restores with the table empty, and an older build ignores the key of a newer file.
*/
CREATE TABLE `funding_match_rows` (
	`account_id` text NOT NULL,
	`side` text NOT NULL,
	`record_key` text NOT NULL,
	`series` text,
	`coin` text NOT NULL,
	`direction` text NOT NULL,
	`amount` text NOT NULL,
	`fee` text,
	`tax` text,
	`time_start` integer NOT NULL,
	`time_end` integer NOT NULL,
	`earn_principal` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`account_id`, `side`, `record_key`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
