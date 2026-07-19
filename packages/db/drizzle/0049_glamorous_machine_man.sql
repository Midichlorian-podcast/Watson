CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"condition_type" varchar(32) NOT NULL,
	"task_id" uuid,
	"target_count" integer,
	"due_date" date,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_milestones_title_valid" CHECK (char_length(trim("project_milestones"."title")) between 1 and 200),
	CONSTRAINT "project_milestones_position_valid" CHECK ("project_milestones"."position" between 0 and 999),
	CONSTRAINT "project_milestones_condition_shape" CHECK ((
				"project_milestones"."condition_type" = 'task_completed' and "project_milestones"."task_id" is not null and "project_milestones"."target_count" is null
			) or (
				"project_milestones"."condition_type" = 'completed_count' and "project_milestones"."task_id" is null and "project_milestones"."target_count" between 1 and 100000
			) or (
				"project_milestones"."condition_type" = 'all_tasks_completed' and "project_milestones"."task_id" is null and "project_milestones"."target_count" is null
			))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "milestones_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_task_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_milestones_title_uq" ON "project_milestones" USING btree ("project_id",lower("title"));--> statement-breakpoint
CREATE INDEX "project_milestones_project_idx" ON "project_milestones" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "project_milestones_task_idx" ON "project_milestones" USING btree ("task_id");--> statement-breakpoint

-- Cílový projekt se zapnutými milníky nesmí být označen Hotovo, pokud nemá
-- alespoň jeden milník nebo některá podmínka není splněná. Funkce používá jen
-- autoritativní data úkolů; ručně přepínaný stav milníku neexistuje.
CREATE OR REPLACE FUNCTION watson_assert_project_milestones(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	v_invalid_count integer;
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM projects p
		WHERE p.id = p_project_id
		  AND p.kind = 'goal'
		  AND p.status = 'done'
		  AND p.milestones_enabled
	) THEN
		RETURN;
	END IF;

	SELECT count(*)::integer INTO v_invalid_count
	FROM project_milestones m
	WHERE m.project_id = p_project_id
	  AND NOT CASE m.condition_type
		WHEN 'task_completed' THEN EXISTS (
			SELECT 1 FROM tasks t
			WHERE t.id = m.task_id
			  AND t.project_id = m.project_id
			  AND t.completed_at IS NOT NULL
			  AND (m.due_date IS NULL OR (t.completed_at AT TIME ZONE 'Europe/Prague')::date <= m.due_date)
		)
		WHEN 'completed_count' THEN (
			SELECT count(*) FROM tasks t
			WHERE t.project_id = m.project_id
			  AND t.kind = 'task'
			  AND t.completed_at IS NOT NULL
			  AND (m.due_date IS NULL OR (t.completed_at AT TIME ZONE 'Europe/Prague')::date <= m.due_date)
		) >= m.target_count
		WHEN 'all_tasks_completed' THEN (
			EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = m.project_id AND t.kind = 'task')
			AND NOT EXISTS (
				SELECT 1 FROM tasks t
				WHERE t.project_id = m.project_id
				  AND t.kind = 'task'
				  AND (
					t.completed_at IS NULL
					OR (m.due_date IS NOT NULL AND (t.completed_at AT TIME ZONE 'Europe/Prague')::date > m.due_date)
				  )
			)
		)
		ELSE false
	  END;

	IF NOT EXISTS (SELECT 1 FROM project_milestones WHERE project_id = p_project_id)
		OR v_invalid_count > 0 THEN
		RAISE EXCEPTION USING
			ERRCODE = 'P0001',
			MESSAGE = 'project_milestones_incomplete';
	END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION watson_check_project_milestones_from_project()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM watson_assert_project_milestones(NEW.id);
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER projects_milestones_completion_guard
AFTER INSERT OR UPDATE OF kind, status, milestones_enabled ON projects
FOR EACH ROW EXECUTE FUNCTION watson_check_project_milestones_from_project();--> statement-breakpoint

CREATE OR REPLACE FUNCTION watson_check_project_milestones_from_definition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		PERFORM watson_assert_project_milestones(OLD.project_id);
	END IF;
	IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
		PERFORM watson_assert_project_milestones(NEW.project_id);
	END IF;
	RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE TRIGGER project_milestones_completion_guard
AFTER INSERT OR UPDATE OR DELETE ON project_milestones
FOR EACH ROW EXECUTE FUNCTION watson_check_project_milestones_from_definition();--> statement-breakpoint

CREATE OR REPLACE FUNCTION watson_check_project_milestones_from_task()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		PERFORM watson_assert_project_milestones(OLD.project_id);
	END IF;
	IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
		PERFORM watson_assert_project_milestones(NEW.project_id);
	ELSIF TG_OP = 'UPDATE' THEN
		PERFORM watson_assert_project_milestones(NEW.project_id);
	END IF;
	RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint

CREATE TRIGGER tasks_project_milestones_completion_guard
AFTER INSERT OR UPDATE OF project_id, completed_at, kind OR DELETE ON tasks
FOR EACH ROW EXECUTE FUNCTION watson_check_project_milestones_from_task();
