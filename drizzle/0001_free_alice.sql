CREATE TABLE `catalog_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`entity_name` text NOT NULL,
	`label` text NOT NULL,
	`description` text NOT NULL,
	`source_name` text NOT NULL,
	`primary_key` text NOT NULL,
	`date_field` text,
	`amount_field` text,
	`status_field` text,
	`maximum_rows` integer NOT NULL,
	`synonyms_json` text DEFAULT '[]' NOT NULL,
	`default_fields_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `catalog_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_entities_snapshot_name_uidx` ON `catalog_entities` (`snapshot_id`,`entity_name`);--> statement-breakpoint
CREATE TABLE `catalog_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_entity_id` text NOT NULL,
	`field_name` text NOT NULL,
	`label` text NOT NULL,
	`description` text NOT NULL,
	`data_type` text NOT NULL,
	`semantic_type` text NOT NULL,
	`display_format` text NOT NULL,
	`sensitivity` text NOT NULL,
	`masked` integer DEFAULT false NOT NULL,
	`groupable` integer DEFAULT false NOT NULL,
	`sortable` integer DEFAULT false NOT NULL,
	`synonyms_json` text DEFAULT '[]' NOT NULL,
	`filter_operators_json` text DEFAULT '[]' NOT NULL,
	`aggregations_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`catalog_entity_id`) REFERENCES `catalog_entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_fields_entity_name_uidx` ON `catalog_fields` (`catalog_entity_id`,`field_name`);--> statement-breakpoint
CREATE TABLE `catalog_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_entity_id` text NOT NULL,
	`metric_name` text NOT NULL,
	`label` text NOT NULL,
	`description` text NOT NULL,
	`operation` text NOT NULL,
	`field_name` text,
	`display_format` text NOT NULL,
	FOREIGN KEY (`catalog_entity_id`) REFERENCES `catalog_entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_metrics_entity_name_uidx` ON `catalog_metrics` (`catalog_entity_id`,`metric_name`);--> statement-breakpoint
CREATE TABLE `catalog_relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`relationship_name` text NOT NULL,
	`from_entity` text NOT NULL,
	`from_field` text NOT NULL,
	`to_entity` text NOT NULL,
	`to_field` text NOT NULL,
	`relationship_kind` text NOT NULL,
	`label` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `catalog_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_relationships_snapshot_name_uidx` ON `catalog_relationships` (`snapshot_id`,`relationship_name`);--> statement-breakpoint
CREATE TABLE `catalog_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`catalog_version` text NOT NULL,
	`policy_version` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`entity_count` integer NOT NULL,
	`field_count` integer NOT NULL,
	`validation_json` text DEFAULT '{}' NOT NULL,
	`synced_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`connector_id`) REFERENCES `data_connectors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_snapshots_connector_version_uidx` ON `catalog_snapshots` (`connector_id`,`catalog_version`);--> statement-breakpoint
CREATE INDEX `catalog_snapshots_connector_status_idx` ON `catalog_snapshots` (`connector_id`,`status`);--> statement-breakpoint
ALTER TABLE `workspace_runs` ADD `catalog_version` text;--> statement-breakpoint
ALTER TABLE `workspace_runs` ADD `policy_version` text;--> statement-breakpoint
ALTER TABLE `workspace_runs` ADD `decision_id` text;--> statement-breakpoint
ALTER TABLE `workspace_runs` ADD `result_count` integer;