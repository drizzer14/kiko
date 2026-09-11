CREATE TABLE `sync_state` (
	`account_id` text PRIMARY KEY NOT NULL,
	`last_sync_at` integer,
	`last_full_sync_at` integer,
	`last_sync_display_at` integer,
	`failed_sync_monobank_ids` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
