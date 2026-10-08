CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`schedule` text NOT NULL,
	`paused_at` integer,
	`pause_reason` text,
	`active_since` integer NOT NULL,
	`last_engaged_at` integer,
	`last_snoozed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminders_account_kind` ON `reminders` (`account_id`,`kind`);--> statement-breakpoint
ALTER TABLE `settings` ADD `reminder_offer_dismissals` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `notifications_deliverable_since` integer;