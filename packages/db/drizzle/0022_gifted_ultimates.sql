ALTER TABLE "meetings" ADD COLUMN "hub_task_id" uuid;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "prev_meeting_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "kind" varchar(12) DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "meeting_id" varchar(120);--> statement-breakpoint
CREATE INDEX "meetings_hub_task_idx" ON "meetings" USING btree ("hub_task_id");--> statement-breakpoint
CREATE INDEX "meetings_series_idx" ON "meetings" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "tasks_meeting_idx" ON "tasks" USING btree ("meeting_id");