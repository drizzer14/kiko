CREATE TABLE `price_points` (
	`instrument` text NOT NULL,
	`day` integer NOT NULL,
	`price` text NOT NULL,
	`currency` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_points_instrument_day` ON `price_points` (`instrument`,`day`);