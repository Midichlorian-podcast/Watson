CREATE TYPE "public"."goal_metric" AS ENUM('completion', 'ontime', 'count', 'project');--> statement-breakpoint
CREATE TYPE "public"."goal_periodic" AS ENUM('none', 'week', 'month', 'quarter', 'year');--> statement-breakpoint
CREATE TYPE "public"."goal_scope" AS ENUM('team', 'project', 'person', 'personal');--> statement-breakpoint
CREATE TABLE "goal_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"label" varchar(300) NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"scope" "goal_scope" DEFAULT 'team' NOT NULL,
	"metric" "goal_metric" DEFAULT 'count' NOT NULL,
	"target" integer DEFAULT 0 NOT NULL,
	"due_date" timestamp with time zone,
	"periodic" "goal_periodic" DEFAULT 'none' NOT NULL,
	"owner_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_projects" ADD CONSTRAINT "goal_projects_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_projects" ADD CONSTRAINT "goal_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_projects" ADD CONSTRAINT "goal_projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_milestones_goal_idx" ON "goal_milestones" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goal_projects_goal_idx" ON "goal_projects" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goals_workspace_idx" ON "goals" USING btree ("workspace_id");