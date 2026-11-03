CREATE TABLE `upload_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`token` text NOT NULL,
	`title` text NOT NULL,
	`message` text,
	`password_hash` text,
	`max_total_bytes` integer,
	`max_submissions` integer,
	`require_name` integer DEFAULT false NOT NULL,
	`require_email` integer DEFAULT false NOT NULL,
	`expires_at` integer NOT NULL,
	`expires_in` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`submission_count` integer DEFAULT 0 NOT NULL,
	`received_bytes` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upload_requests_token_unique` ON `upload_requests` (`token`);--> statement-breakpoint
CREATE INDEX `upload_requests_owner_id_idx` ON `upload_requests` (`owner_id`);--> statement-breakpoint
CREATE INDEX `upload_requests_status_expires_at_idx` ON `upload_requests` (`status`,`expires_at`);--> statement-breakpoint
ALTER TABLE `transfers` ADD `source` text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE `transfers` ADD `upload_request_id` text REFERENCES `upload_requests`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `transfers` ADD `sender_name` text;--> statement-breakpoint
ALTER TABLE `transfers` ADD `sender_email` text;--> statement-breakpoint
CREATE INDEX `transfers_upload_request_id_idx` ON `transfers` (`upload_request_id`);