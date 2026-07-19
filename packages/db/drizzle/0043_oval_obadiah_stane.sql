CREATE TABLE "task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"blocking_task_id" uuid NOT NULL,
	"blocked_task_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_not_self" CHECK ("task_dependencies"."blocking_task_id" <> "task_dependencies"."blocked_task_id")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "task_conflict_policy" varchar(16) DEFAULT 'warning' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocking_same_project_fk" FOREIGN KEY ("blocking_task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocked_same_project_fk" FOREIGN KEY ("blocked_task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_dependencies_pair_uq" ON "task_dependencies" USING btree ("blocking_task_id","blocked_task_id");--> statement-breakpoint
CREATE INDEX "task_dependencies_blocking_idx" ON "task_dependencies" USING btree ("blocking_task_id");--> statement-breakpoint
CREATE INDEX "task_dependencies_blocked_idx" ON "task_dependencies" USING btree ("blocked_task_id");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_task_conflict_policy_valid" CHECK ("workspaces"."task_conflict_policy" in ('warning', 'strict'));--> statement-breakpoint

-- Serializovaný DAG invariant: ani dva souběžné opačné inserty nesmí vytvořit cyklus.
CREATE OR REPLACE FUNCTION watson_reject_task_dependency_cycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	PERFORM pg_advisory_xact_lock(hashtext(NEW.project_id::text));
	IF EXISTS (
		WITH RECURSIVE reachable(id) AS (
			SELECT d.blocked_task_id
			FROM task_dependencies d
			WHERE d.blocking_task_id = NEW.blocked_task_id AND d.id <> NEW.id
			UNION
			SELECT d.blocked_task_id
			FROM task_dependencies d
			JOIN reachable r ON d.blocking_task_id = r.id
			WHERE d.id <> NEW.id
		)
		SELECT 1 FROM reachable WHERE id = NEW.blocking_task_id
	) THEN
		RAISE EXCEPTION 'task_dependency_cycle' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER task_dependencies_reject_cycle
BEFORE INSERT OR UPDATE OF blocking_task_id, blocked_task_id, project_id ON task_dependencies
FOR EACH ROW EXECUTE FUNCTION watson_reject_task_dependency_cycle();--> statement-breakpoint

-- Ve strict režimu je zákaz dokončení serverový invariant, ne pouze UI pojistka.
CREATE OR REPLACE FUNCTION watson_enforce_task_dependency_policy()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	policy varchar(16);
BEGIN
	IF OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL THEN
		PERFORM pg_advisory_xact_lock(hashtext(NEW.project_id::text));
		SELECT w.task_conflict_policy INTO policy
		FROM projects p JOIN workspaces w ON w.id = p.workspace_id
		WHERE p.id = NEW.project_id;
		IF policy = 'strict' AND EXISTS (
			SELECT 1
			FROM task_dependencies d
			JOIN tasks blocker ON blocker.id = d.blocking_task_id
			WHERE d.blocked_task_id = NEW.id
			  AND blocker.completed_at IS NULL
		) THEN
			RAISE EXCEPTION 'task_blocked_by_dependency' USING ERRCODE = '23514';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER tasks_enforce_dependency_policy
BEFORE UPDATE OF completed_at ON tasks
FOR EACH ROW EXECUTE FUNCTION watson_enforce_task_dependency_policy();
