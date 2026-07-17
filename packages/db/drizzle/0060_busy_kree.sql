CREATE TYPE "public"."recurrence_edit_scope" AS ENUM('this_occurrence', 'this_and_future', 'all');--> statement-breakpoint
CREATE TABLE "task_recurrence_edit_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"occurrence_date" varchar(10) NOT NULL,
	"scope" "recurrence_edit_scope" NOT NULL,
	"created_by" uuid NOT NULL,
	"operation_id" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"undone_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_recurrence_edit_batches_occurrence_date_format" CHECK ("task_recurrence_edit_batches"."occurrence_date" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD COLUMN "override_due_date" date;--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD COLUMN "override_start_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD COLUMN "override_start_timezone" varchar(64);--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD COLUMN "override_duration_min" integer;--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "task_recurrence_edit_batches" ADD CONSTRAINT "task_recurrence_edit_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recurrence_edit_batches" ADD CONSTRAINT "task_recurrence_edit_batches_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recurrence_edit_batches" ADD CONSTRAINT "task_recurrence_edit_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_recurrence_edit_batches_actor_operation_uq" ON "task_recurrence_edit_batches" USING btree ("created_by","operation_id");--> statement-breakpoint
CREATE INDEX "task_recurrence_edit_batches_task_idx" ON "task_recurrence_edit_batches" USING btree ("task_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "task_recurrence_edit_batches_expiry_idx" ON "task_recurrence_edit_batches" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD CONSTRAINT "task_occurrence_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD CONSTRAINT "task_occ_overrides_task_same_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_occ_overrides_target_date_idx" ON "task_occurrence_overrides" USING btree ("override_due_date");--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD CONSTRAINT "task_occ_overrides_date_format" CHECK ("task_occurrence_overrides"."occ_date" ~ '^\d{4}-\d{2}-\d{2}$');--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD CONSTRAINT "task_occ_overrides_done_or_skipped" CHECK (not ("task_occurrence_overrides"."done" and "task_occurrence_overrides"."skipped"));--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD CONSTRAINT "task_occ_overrides_start_timezone_pair" CHECK (("task_occurrence_overrides"."override_start_date" is null) = ("task_occurrence_overrides"."override_start_timezone" is null));--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD CONSTRAINT "task_occ_overrides_start_requires_due_date" CHECK ("task_occurrence_overrides"."override_start_date" is null or "task_occurrence_overrides"."override_due_date" is not null);--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD CONSTRAINT "task_occ_overrides_timezone_format" CHECK ("task_occurrence_overrides"."override_start_timezone" is null or "task_occurrence_overrides"."override_start_timezone" ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$');--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD CONSTRAINT "task_occ_overrides_duration_positive" CHECK ("task_occurrence_overrides"."override_duration_min" is null or "task_occurrence_overrides"."override_duration_min" between 1 and 10080);--> statement-breakpoint
ALTER TABLE "task_occurrence_overrides" ADD CONSTRAINT "task_occ_overrides_version_positive" CHECK ("task_occurrence_overrides"."version" > 0);