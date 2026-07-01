CREATE TYPE "public"."chain_due_basis" AS ENUM('from_anchor', 'from_activation', 'from_prev_done');--> statement-breakpoint
CREATE TYPE "public"."chain_gate" AS ENUM('after_previous', 'with_previous', 'manual');--> statement-breakpoint
CREATE TYPE "public"."chain_state" AS ENUM('active', 'done', 'canceled', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."chain_step_state" AS ENUM('dormant', 'active', 'done', 'skipped');--> statement-breakpoint
CREATE TABLE "chain_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"gate" "chain_gate" DEFAULT 'after_previous' NOT NULL,
	"step_state" "chain_step_state" DEFAULT 'dormant' NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"template_id" uuid,
	"name" varchar(200) NOT NULL,
	"description" text,
	"anchor_date" timestamp with time zone,
	"state" "chain_state" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chain_steps" ADD CONSTRAINT "chain_steps_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_steps" ADD CONSTRAINT "chain_steps_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_steps" ADD CONSTRAINT "chain_steps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chains" ADD CONSTRAINT "chains_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chains" ADD CONSTRAINT "chains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chains" ADD CONSTRAINT "chains_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chain_steps_chain_position_uq" ON "chain_steps" USING btree ("chain_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_steps_task_uq" ON "chain_steps" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "chain_steps_project_idx" ON "chain_steps" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "chains_project_idx" ON "chains" USING btree ("project_id");