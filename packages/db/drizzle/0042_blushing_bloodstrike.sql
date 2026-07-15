ALTER TABLE "filters" ADD COLUMN "surface" varchar(32) DEFAULT 'tasks' NOT NULL;--> statement-breakpoint
ALTER TABLE "filters" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "filters" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "filters" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "filters_personal_name_uq" ON "filters" USING btree ("workspace_id","user_id","surface",lower("name")) WHERE "filters"."owner_scope" = 'user';--> statement-breakpoint
CREATE UNIQUE INDEX "filters_team_name_uq" ON "filters" USING btree ("workspace_id","surface",lower("name")) WHERE "filters"."owner_scope" = 'workspace';--> statement-breakpoint
CREATE INDEX "filters_workspace_scope_idx" ON "filters" USING btree ("workspace_id","owner_scope","surface");--> statement-breakpoint
ALTER TABLE "filters" ADD CONSTRAINT "filters_surface_valid" CHECK ("filters"."surface" in ('tasks'));--> statement-breakpoint
ALTER TABLE "filters" ADD CONSTRAINT "filters_config_object" CHECK (jsonb_typeof("filters"."config") = 'object');--> statement-breakpoint
ALTER TABLE "filters" ADD CONSTRAINT "filters_version_positive" CHECK ("filters"."version" > 0);--> statement-breakpoint
ALTER TABLE "filters" ADD CONSTRAINT "filters_tasks_v1_owner" CHECK ("filters"."query" <> 'tasks:v1' OR ("filters"."workspace_id" IS NOT NULL AND "filters"."user_id" IS NOT NULL));