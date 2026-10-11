DROP INDEX `saved_workspaces_owner_prompt_uidx`;--> statement-breakpoint
CREATE INDEX `saved_workspaces_owner_prompt_idx` ON `saved_workspaces` (`owner_user_id`,`prompt`);