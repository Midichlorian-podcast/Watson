ALTER TABLE "task_recurrence_prefixes" DROP CONSTRAINT "task_recurrence_prefixes_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "task_recurrence_prefixes" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "task_recurrence_prefixes" ADD CONSTRAINT "task_recurrence_prefixes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;