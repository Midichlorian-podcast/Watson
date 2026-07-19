ALTER TABLE "filters" DROP CONSTRAINT "filters_surface_valid";--> statement-breakpoint
ALTER TABLE "filters" DROP CONSTRAINT "filters_tasks_v1_owner";--> statement-breakpoint
ALTER TABLE "filters" ADD CONSTRAINT "filters_surface_valid" CHECK ("filters"."surface" in ('tasks', 'upcoming'));--> statement-breakpoint
ALTER TABLE "filters" ADD CONSTRAINT "filters_tasks_v1_owner" CHECK ("filters"."query" NOT IN ('tasks:v1', 'upcoming:v1') OR ("filters"."workspace_id" IS NOT NULL AND "filters"."user_id" IS NOT NULL));