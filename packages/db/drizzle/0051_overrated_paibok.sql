CREATE TABLE "task_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"assignee_id" uuid NOT NULL,
	"requested_by" uuid,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"note" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_acceptances_status_valid" CHECK ("task_acceptances"."status" in ('pending', 'accepted', 'declined', 'cancelled')),
	CONSTRAINT "task_acceptances_response_shape" CHECK (("task_acceptances"."status" = 'pending' and "task_acceptances"."responded_at" is null) or ("task_acceptances"."status" <> 'pending' and "task_acceptances"."responded_at" is not null)),
	CONSTRAINT "task_acceptances_note_valid" CHECK ("task_acceptances"."note" is null or char_length("task_acceptances"."note") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "urgent_acceptance_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "urgent_acceptance_priority" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TYPE "public"."actor_type" ADD VALUE IF NOT EXISTS 'system';--> statement-breakpoint
ALTER TABLE "task_acceptances" ADD CONSTRAINT "task_acceptances_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_acceptances" ADD CONSTRAINT "task_acceptances_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_acceptances" ADD CONSTRAINT "task_acceptances_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_acceptances" ADD CONSTRAINT "task_acceptances_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_acceptances" ADD CONSTRAINT "task_acceptances_task_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE UNIQUE INDEX "task_acceptances_task_assignee_uq" ON "task_acceptances" USING btree ("task_id","assignee_id");--> statement-breakpoint
CREATE INDEX "task_acceptances_project_idx" ON "task_acceptances" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_acceptances_assignee_status_idx" ON "task_acceptances" USING btree ("assignee_id","status");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_urgent_acceptance_priority_valid" CHECK ("projects"."urgent_acceptance_priority" between 1 and 2);--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_task_requires_acceptance(p_task_id uuid, p_assignee_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
	SELECT COALESCE((
		SELECT p.urgent_acceptance_enabled
			AND t.kind = 'task'
			AND t.completed_at IS NULL
			AND t.priority <= p.urgent_acceptance_priority
			AND t.created_by IS DISTINCT FROM p_assignee_id
			AND EXISTS (
				SELECT 1 FROM assignments a
				WHERE a.task_id = t.id AND a.user_id = p_assignee_id
			)
		FROM tasks t
		JOIN projects p ON p.id = t.project_id
		WHERE t.id = p_task_id
	), false)
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_reconcile_task_acceptances(p_task_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
	v_task tasks%ROWTYPE;
	v_workspace_id uuid;
	v_row record;
BEGIN
	IF current_setting('watson.skip_acceptance_reconcile', true) = 'on' THEN
		RETURN;
	END IF;

	SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
	IF NOT FOUND THEN
		RETURN;
	END IF;
	SELECT workspace_id INTO v_workspace_id FROM projects WHERE id = v_task.project_id;

	FOR v_row IN
		INSERT INTO task_acceptances (
			id, task_id, project_id, assignee_id, requested_by, status,
			note, requested_at, responded_at, created_at, updated_at
		)
		SELECT gen_random_uuid(), v_task.id, v_task.project_id, a.user_id,
			v_task.created_by, 'pending', NULL, now(), NULL, now(), now()
		FROM assignments a
		WHERE a.task_id = v_task.id
		  AND watson_task_requires_acceptance(v_task.id, a.user_id)
		ON CONFLICT (task_id, assignee_id) DO UPDATE SET
			project_id = excluded.project_id,
			requested_by = excluded.requested_by,
			status = 'pending',
			note = NULL,
			requested_at = now(),
			responded_at = NULL,
			updated_at = now()
		WHERE task_acceptances.status = 'cancelled'
		RETURNING id, assignee_id
	LOOP
		INSERT INTO audit_events (
			workspace_id, actor_type, entity, entity_id, action, diff
		) VALUES (
			v_workspace_id, 'system', 'task_acceptances', v_row.id, 'requested',
			jsonb_build_object(
				'task_id', v_task.id,
				'project_id', v_task.project_id,
				'assignee_id', v_row.assignee_id,
				'status', 'pending'
			)
		);
	END LOOP;

	FOR v_row IN
		UPDATE task_acceptances acceptance SET
			status = 'cancelled',
			responded_at = now(),
			updated_at = now()
		WHERE acceptance.task_id = v_task.id
		  AND acceptance.status <> 'cancelled'
		  AND NOT watson_task_requires_acceptance(v_task.id, acceptance.assignee_id)
		RETURNING id, assignee_id
	LOOP
		INSERT INTO audit_events (
			workspace_id, actor_type, entity, entity_id, action, diff
		) VALUES (
			v_workspace_id, 'system', 'task_acceptances', v_row.id, 'cancelled',
			jsonb_build_object(
				'task_id', v_task.id,
				'project_id', v_task.project_id,
				'assignee_id', v_row.assignee_id,
				'status', 'cancelled'
			)
		);
	END LOOP;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_reconcile_acceptance_from_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		PERFORM watson_reconcile_task_acceptances(OLD.task_id);
		RETURN OLD;
	END IF;
	IF TG_OP = 'UPDATE' AND OLD.task_id IS DISTINCT FROM NEW.task_id THEN
		PERFORM watson_reconcile_task_acceptances(OLD.task_id);
	END IF;
	PERFORM watson_reconcile_task_acceptances(NEW.task_id);
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER assignments_acceptance_reconcile
AFTER INSERT OR DELETE OR UPDATE OF task_id, project_id, user_id ON assignments
FOR EACH ROW EXECUTE FUNCTION watson_reconcile_acceptance_from_assignment();--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_reconcile_acceptance_from_task()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	PERFORM watson_reconcile_task_acceptances(NEW.id);
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER tasks_acceptance_reconcile
AFTER UPDATE OF priority, kind ON tasks
FOR EACH ROW EXECUTE FUNCTION watson_reconcile_acceptance_from_task();--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_reconcile_acceptance_from_project()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	v_task_id uuid;
BEGIN
	FOR v_task_id IN SELECT id FROM tasks WHERE project_id = NEW.id LOOP
		PERFORM watson_reconcile_task_acceptances(v_task_id);
	END LOOP;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER projects_acceptance_reconcile
AFTER UPDATE OF urgent_acceptance_enabled, urgent_acceptance_priority ON projects
FOR EACH ROW EXECUTE FUNCTION watson_reconcile_acceptance_from_project();--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_guard_task_acceptance_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL AND EXISTS (
		SELECT 1
		FROM assignments a
		WHERE a.task_id = NEW.id
		  AND watson_task_requires_acceptance(NEW.id, a.user_id)
		  AND NOT EXISTS (
			SELECT 1 FROM task_acceptances acceptance
			WHERE acceptance.task_id = NEW.id
			  AND acceptance.assignee_id = a.user_id
			  AND acceptance.status = 'accepted'
		  )
	) THEN
		RAISE EXCEPTION 'task_acceptance_required' USING ERRCODE = 'P0001';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER tasks_acceptance_completion_guard
BEFORE UPDATE OF completed_at ON tasks
FOR EACH ROW EXECUTE FUNCTION watson_guard_task_acceptance_completion();--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_guard_assignment_acceptance_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL
	   AND watson_task_requires_acceptance(NEW.task_id, NEW.user_id)
	   AND NOT EXISTS (
		SELECT 1 FROM task_acceptances acceptance
		WHERE acceptance.task_id = NEW.task_id
		  AND acceptance.assignee_id = NEW.user_id
		  AND acceptance.status = 'accepted'
	   ) THEN
		RAISE EXCEPTION 'task_acceptance_required' USING ERRCODE = 'P0001';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER assignments_acceptance_completion_guard
BEFORE UPDATE OF completed_at ON assignments
FOR EACH ROW EXECUTE FUNCTION watson_guard_assignment_acceptance_completion();
