ALTER TABLE `transactions` ADD `loan_holding_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `loan_link_source` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `loan_link_rejected` integer DEFAULT false NOT NULL;