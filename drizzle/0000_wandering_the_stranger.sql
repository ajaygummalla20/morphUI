CREATE TABLE `access_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`dataset_scope` text NOT NULL,
	`permitted_field_count` integer NOT NULL,
	`access_mode` text DEFAULT 'read_only' NOT NULL,
	`team_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `access_rules_organization_idx` ON `access_rules` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `access_rules_org_name_uidx` ON `access_rules` (`organization_id`,`name`);--> statement-breakpoint
CREATE TABLE `app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`full_name` text NOT NULL,
	`role` text DEFAULT 'admin' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_org_email_uidx` ON `app_users` (`organization_id`,`email`);--> statement-breakpoint
CREATE INDEX `app_users_organization_idx` ON `app_users` (`organization_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_user_id` text,
	`actor_label` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`outcome` text NOT NULL,
	`request_id` text NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_request_uidx` ON `audit_events` (`request_id`);--> statement-breakpoint
CREATE INDEX `audit_events_organization_created_idx` ON `audit_events` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `connector_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`table_name` text NOT NULL,
	`allowed_fields_json` text DEFAULT '[]' NOT NULL,
	`masked_fields_json` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`connector_id`) REFERENCES `data_connectors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_permissions_table_uidx` ON `connector_permissions` (`connector_id`,`table_name`);--> statement-breakpoint
CREATE INDEX `connector_permissions_connector_idx` ON `connector_permissions` (`connector_id`);--> statement-breakpoint
CREATE TABLE `data_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`name` text NOT NULL,
	`engine` text NOT NULL,
	`private_host` text NOT NULL,
	`database_name` text NOT NULL,
	`region` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`last_checked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `data_connectors_organization_idx` ON `data_connectors` (`organization_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`data_region` text DEFAULT 'india-west' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_uidx` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `saved_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`intent` text,
	`source_mode` text,
	`workspace_json` text,
	`pinned` integer DEFAULT false NOT NULL,
	`last_opened_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_workspaces_owner_idx` ON `saved_workspaces` (`owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `saved_workspaces_owner_prompt_uidx` ON `saved_workspaces` (`owner_user_id`,`prompt`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email_safety_alerts` integer DEFAULT true NOT NULL,
	`default_section` text DEFAULT 'workspaces' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`saved_workspace_id` text,
	`prompt` text NOT NULL,
	`intent` text,
	`query_plan_json` text,
	`result_metadata_json` text,
	`status` text NOT NULL,
	`duration_ms` integer,
	`error_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`saved_workspace_id`) REFERENCES `saved_workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workspace_runs_organization_created_idx` ON `workspace_runs` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workspace_runs_user_created_idx` ON `workspace_runs` (`user_id`,`created_at`);