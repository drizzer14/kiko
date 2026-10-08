CREATE TABLE `bond_register` (
	`isin` text PRIMARY KEY NOT NULL,
	`terms` text NOT NULL,
	`fetched_at` integer NOT NULL
);
