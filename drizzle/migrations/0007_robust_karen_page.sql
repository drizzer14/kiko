CREATE TABLE `category_overrides` (
	`normalized_name` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
