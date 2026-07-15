ALTER TABLE "meetings" ADD CONSTRAINT "meetings_status_valid" CHECK ("meetings"."status" in ('new', 'scheduled', 'transcribed', 'extracted', 'committed'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_days_positive" CHECK ("tasks"."days" is null or "tasks"."days" between 1 and 3650);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_duration_positive" CHECK ("tasks"."duration_min" is null or "tasks"."duration_min" between 1 and 10080);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deadline_not_before_due" CHECK ("tasks"."deadline" is null or "tasks"."due_date" is null or "tasks"."deadline" >= "tasks"."due_date");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_meeting_has_id" CHECK ("tasks"."kind" <> 'meeting' or "tasks"."meeting_id" is not null);--> statement-breakpoint
ALTER TABLE "statuses" ADD CONSTRAINT "statuses_scope_owner_valid" CHECK (("statuses"."scope" = 'project' and "statuses"."project_id" is not null and "statuses"."workspace_id" is null)
				or ("statuses"."scope" = 'workspace' and "statuses"."workspace_id" is not null and "statuses"."project_id" is null));