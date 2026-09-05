ALTER TABLE `settings` ADD `lock_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `lock_grace_seconds` integer DEFAULT 30 NOT NULL;