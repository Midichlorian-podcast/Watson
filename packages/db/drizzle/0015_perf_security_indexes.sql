CREATE INDEX "comments_project_idx" ON "comments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "reminders_task_idx" ON "reminders" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "reminders_user_idx" ON "reminders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reminders_pending_idx" ON "reminders" USING btree ("remind_at") WHERE sent_at IS NULL;--> statement-breakpoint
CREATE INDEX "task_activity_project_idx" ON "task_activity" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "assignments_project_idx" ON "assignments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "assignments_user_idx" ON "assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_occ_overrides_project_idx" ON "task_occurrence_overrides" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_user_colors_project_idx" ON "task_user_colors" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_user_colors_user_idx" ON "task_user_colors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_workspace_idx" ON "projects" USING btree ("workspace_id");