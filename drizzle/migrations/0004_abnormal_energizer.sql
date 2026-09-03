CREATE TABLE `currency_rate_history` (
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`day` integer NOT NULL,
	`rate` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `currency_rate_history_pair_day` ON `currency_rate_history` (`base`,`quote`,`day`);