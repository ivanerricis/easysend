CREATE TABLE `storage_deletions` (
	`id` text PRIMARY KEY NOT NULL,
	`storage` text NOT NULL,
	`name` text NOT NULL,
	`delete_after` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `storage_deletions_delete_after_idx` ON `storage_deletions` (`delete_after`);--> statement-breakpoint
CREATE TABLE `storage_migrations` (
	`id` text PRIMARY KEY NOT NULL,
	`target` text NOT NULL,
	`status` text NOT NULL,
	`total_files` integer DEFAULT 0 NOT NULL,
	`done_files` integer DEFAULT 0 NOT NULL,
	`total_bytes` integer DEFAULT 0 NOT NULL,
	`done_bytes` integer DEFAULT 0 NOT NULL,
	`failed_files` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`started_by` text,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `storage_migrations_status_idx` ON `storage_migrations` (`status`);--> statement-breakpoint
ALTER TABLE `transfer_files` ADD `storage` text DEFAULT 'local' NOT NULL;