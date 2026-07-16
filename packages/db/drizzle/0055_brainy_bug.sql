CREATE TABLE "availability_task_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"assignee_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"reason" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_task_overrides_reason_length" CHECK (char_length("availability_task_overrides"."reason") between 8 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "availability_blocks_id_workspace_user_uq" ON "availability_blocks" USING btree ("id","workspace_id","user_id");--> statement-breakpoint
ALTER TABLE "availability_task_overrides" ADD CONSTRAINT "availability_task_overrides_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_task_overrides" ADD CONSTRAINT "availability_task_overrides_block_id_availability_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."availability_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_task_overrides" ADD CONSTRAINT "availability_task_overrides_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_task_overrides" ADD CONSTRAINT "availability_task_overrides_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_task_overrides" ADD CONSTRAINT "availability_task_overrides_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_task_overrides" ADD CONSTRAINT "availability_task_overrides_block_scope_fk" FOREIGN KEY ("block_id","workspace_id","assignee_id") REFERENCES "public"."availability_blocks"("id","workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "availability_task_overrides_scope_uq" ON "availability_task_overrides" USING btree ("block_id","task_id","assignee_id");--> statement-breakpoint
CREATE INDEX "availability_task_overrides_task_idx" ON "availability_task_overrides" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "availability_task_overrides_workspace_idx" ON "availability_task_overrides" USING btree ("workspace_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_validate_availability_task_override()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	task_workspace uuid;
	block_kind varchar(20);
	block_cancelled_at timestamptz;
BEGIN
	SELECT p.workspace_id INTO task_workspace
	FROM tasks t
	JOIN projects p ON p.id = t.project_id
	WHERE t.id = NEW.task_id;
	IF task_workspace IS NULL OR task_workspace <> NEW.workspace_id THEN
		RAISE EXCEPTION 'availability_override_task_workspace_mismatch' USING ERRCODE = '23514';
	END IF;

	SELECT kind, cancelled_at INTO block_kind, block_cancelled_at
	FROM availability_blocks
	WHERE id = NEW.block_id
	  AND workspace_id = NEW.workspace_id
	  AND user_id = NEW.assignee_id;
	IF block_kind IS NULL OR block_kind <> 'focus' OR block_cancelled_at IS NOT NULL THEN
		RAISE EXCEPTION 'availability_override_requires_active_focus_block' USING ERRCODE = '23514';
	END IF;

	IF NEW.actor_user_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM memberships
		WHERE workspace_id = NEW.workspace_id AND user_id = NEW.actor_user_id
	) THEN
		RAISE EXCEPTION 'availability_override_actor_not_member' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER availability_task_overrides_scope_guard
BEFORE INSERT OR UPDATE ON availability_task_overrides
FOR EACH ROW EXECUTE FUNCTION watson_validate_availability_task_override();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_assert_task_availability(p_task_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
	task_start timestamptz;
	task_end timestamptz;
	task_workspace uuid;
	conflict_policy varchar(16);
	conflict_block uuid;
	conflict_kind varchar(20);
BEGIN
	SELECT t.start_date,
	       t.start_date + make_interval(mins => COALESCE(t.duration_min, 30)),
	       p.workspace_id,
	       w.task_conflict_policy
	INTO task_start, task_end, task_workspace, conflict_policy
	FROM tasks t
	JOIN projects p ON p.id = t.project_id
	JOIN workspaces w ON w.id = p.workspace_id
	WHERE t.id = p_task_id;

	IF task_start IS NULL THEN
		RETURN;
	END IF;

	SELECT b.id, b.kind INTO conflict_block, conflict_kind
	FROM availability_blocks b
	WHERE b.workspace_id = task_workspace
	  AND b.user_id = p_user_id
	  AND b.cancelled_at IS NULL
	  AND b.starts_at < task_end
	  AND b.ends_at > task_start
	  AND (
		(b.kind = 'focus' AND NOT EXISTS (
			SELECT 1 FROM availability_task_overrides o
			WHERE o.block_id = b.id
			  AND o.task_id = p_task_id
			  AND o.assignee_id = p_user_id
		))
		OR (b.kind <> 'focus' AND conflict_policy = 'strict')
	  )
	ORDER BY CASE b.kind
		WHEN 'focus' THEN 4
		WHEN 'absence' THEN 3
		WHEN 'unavailable' THEN 2
		ELSE 1
	END DESC, b.starts_at
	LIMIT 1;

	IF conflict_block IS NOT NULL THEN
		RAISE EXCEPTION 'availability_task_conflict'
			USING ERRCODE = '23514',
			DETAIL = format('block_id=%s;kind=%s;assignee_id=%s', conflict_block, conflict_kind, p_user_id);
	END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_guard_assignment_availability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	PERFORM watson_assert_task_availability(NEW.task_id, NEW.user_id);
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER assignments_availability_guard
AFTER INSERT OR UPDATE OF task_id, user_id ON assignments
FOR EACH ROW EXECUTE FUNCTION watson_guard_assignment_availability();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_guard_task_schedule_availability()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	assignee record;
BEGIN
	IF NEW.start_date IS NOT DISTINCT FROM OLD.start_date
		AND NEW.duration_min IS NOT DISTINCT FROM OLD.duration_min
		AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
		RETURN NEW;
	END IF;
	FOR assignee IN SELECT user_id FROM assignments WHERE task_id = NEW.id LOOP
		PERFORM watson_assert_task_availability(NEW.id, assignee.user_id);
	END LOOP;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tasks_schedule_availability_guard
AFTER UPDATE OF start_date, duration_min, project_id ON tasks
FOR EACH ROW EXECUTE FUNCTION watson_guard_task_schedule_availability();
