CREATE TABLE "automation_rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"published_by" uuid NOT NULL,
	"publish_operation_id" varchar(128) NOT NULL,
	"publish_request_hash" varchar(64) NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_rule_versions_version_positive" CHECK ("automation_rule_versions"."version" > 0),
	CONSTRAINT "automation_rule_versions_config_object" CHECK (jsonb_typeof("automation_rule_versions"."config") = 'object')
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"state" varchar(16) DEFAULT 'enabled' NOT NULL,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"draft_config" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"create_operation_id" varchar(128) NOT NULL,
	"create_request_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_rules_name_valid" CHECK (length(trim("automation_rules"."name")) between 1 and 200),
	CONSTRAINT "automation_rules_state_valid" CHECK ("automation_rules"."state" in ('enabled', 'paused', 'archived')),
	CONSTRAINT "automation_rules_draft_revision_positive" CHECK ("automation_rules"."draft_revision" > 0),
	CONSTRAINT "automation_rules_draft_config_object" CHECK (jsonb_typeof("automation_rules"."draft_config") = 'object')
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"rule_version_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"trigger_type" varchar(32) NOT NULL,
	"result" jsonb,
	"error_code" varchar(64),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"undo_expires_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_runs_status_valid" CHECK ("automation_runs"."status" in ('queued', 'running', 'succeeded', 'skipped', 'failed', 'undone')),
	CONSTRAINT "automation_runs_trigger_valid" CHECK ("automation_runs"."trigger_type" in ('task_created', 'task_completed', 'task_reopened'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rules_id_scope_uq" ON "automation_rules" USING btree ("id","workspace_id","project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rule_versions_id_scope_uq" ON "automation_rule_versions" USING btree ("id","rule_id","workspace_id","project_id");
--> statement-breakpoint
ALTER TABLE "automation_rule_versions" ADD CONSTRAINT "automation_rule_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rule_versions" ADD CONSTRAINT "automation_rule_versions_rule_scope_fk" FOREIGN KEY ("rule_id","workspace_id","project_id") REFERENCES "public"."automation_rules"("id","workspace_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_project_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_scope_fk" FOREIGN KEY ("rule_id","workspace_id","project_id") REFERENCES "public"."automation_rules"("id","workspace_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_version_scope_fk" FOREIGN KEY ("rule_version_id","rule_id","workspace_id","project_id") REFERENCES "public"."automation_rule_versions"("id","rule_id","workspace_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rule_versions_rule_version_uq" ON "automation_rule_versions" USING btree ("rule_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rule_versions_actor_operation_uq" ON "automation_rule_versions" USING btree ("published_by","publish_operation_id");--> statement-breakpoint
CREATE INDEX "automation_rule_versions_rule_idx" ON "automation_rule_versions" USING btree ("rule_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rules_actor_operation_uq" ON "automation_rules" USING btree ("created_by","create_operation_id");--> statement-breakpoint
CREATE INDEX "automation_rules_project_idx" ON "automation_rules" USING btree ("project_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_version_event_uq" ON "automation_runs" USING btree ("rule_version_id","event_id");--> statement-breakpoint
CREATE INDEX "automation_runs_status_idx" ON "automation_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "automation_runs_rule_idx" ON "automation_runs" USING btree ("rule_id","created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_guard_automation_rule_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id <> OLD.workspace_id
     OR NEW.project_id <> OLD.project_id
     OR NEW.created_by <> OLD.created_by
     OR NEW.create_operation_id <> OLD.create_operation_id
     OR NEW.create_request_hash <> OLD.create_request_hash THEN
    RAISE EXCEPTION 'automation_rule_identity_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER automation_rules_scope_guard
BEFORE UPDATE ON automation_rules
FOR EACH ROW EXECUTE FUNCTION watson_guard_automation_rule_scope();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_guard_automation_version_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'automation_rule_version_immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER automation_rule_versions_update_guard
BEFORE UPDATE ON automation_rule_versions
FOR EACH ROW EXECUTE FUNCTION watson_guard_automation_version_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_guard_automation_run_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rule_id <> OLD.rule_id
     OR NEW.rule_version_id <> OLD.rule_version_id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.project_id <> OLD.project_id
     OR NEW.event_id <> OLD.event_id
     OR NEW.task_id <> OLD.task_id
     OR NEW.trigger_type <> OLD.trigger_type
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'automation_run_identity_immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (OLD.status = 'queued' AND NEW.status IN ('running', 'skipped', 'failed'))
    OR (OLD.status = 'running' AND NEW.status IN ('succeeded', 'skipped', 'failed'))
    OR (OLD.status = 'succeeded' AND NEW.status = 'undone')
    OR (OLD.status = NEW.status)
  ) THEN
    RAISE EXCEPTION 'automation_run_transition_invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER automation_runs_transition_guard
BEFORE UPDATE ON automation_runs
FOR EACH ROW EXECUTE FUNCTION watson_guard_automation_run_transition();
