ALTER TABLE "meetings" ADD CONSTRAINT "meetings_hub_task_id_tasks_id_fk" FOREIGN KEY ("hub_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- R1: projektový advisory lock serializuje souběžné přesuny, cycle detection
-- brání A→B/B→A a celková výška stromu nesmí překročit 3 úrovně ani při
-- přesunu rodiče s existujícími potomky.
CREATE OR REPLACE FUNCTION watson_validate_task_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	ancestor_depth integer := 0;
	descendant_depth integer := 0;
	has_cycle boolean := false;
BEGIN
	PERFORM pg_advisory_xact_lock(hashtextextended(NEW.project_id::text, 0));
	IF NEW.parent_id IS NULL THEN
		RETURN NEW;
	END IF;
	IF NEW.parent_id = NEW.id THEN
		RAISE EXCEPTION 'task_parent_self_cycle' USING ERRCODE = '23514';
	END IF;

	WITH RECURSIVE ancestors AS (
		SELECT t.id, t.parent_id, ARRAY[t.id] AS path
		FROM tasks t WHERE t.id = NEW.parent_id
		UNION ALL
		SELECT t.id, t.parent_id, a.path || t.id
		FROM tasks t JOIN ancestors a ON t.id = a.parent_id
		WHERE NOT t.id = ANY(a.path)
	)
	SELECT count(*)::int, COALESCE(bool_or(id = NEW.id), false)
	INTO ancestor_depth, has_cycle
	FROM ancestors;
	IF has_cycle THEN
		RAISE EXCEPTION 'task_parent_cycle' USING ERRCODE = '23514';
	END IF;

	WITH RECURSIVE descendants AS (
		SELECT NEW.id AS id, 0 AS depth, ARRAY[NEW.id] AS path
		UNION ALL
		SELECT t.id, d.depth + 1, d.path || t.id
		FROM tasks t JOIN descendants d ON t.parent_id = d.id
		WHERE t.id <> NEW.id AND NOT t.id = ANY(d.path)
	)
	SELECT COALESCE(max(depth), 0)::int INTO descendant_depth FROM descendants;
	IF ancestor_depth + 1 + descendant_depth > 3 THEN
		RAISE EXCEPTION 'task_hierarchy_max_depth_3' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS validate_task_hierarchy ON tasks;
--> statement-breakpoint
CREATE TRIGGER validate_task_hierarchy
BEFORE INSERT OR UPDATE OF parent_id, project_id ON tasks
FOR EACH ROW EXECUTE FUNCTION watson_validate_task_hierarchy();
--> statement-breakpoint

-- Status tasku musí patřit jeho projektu, nebo workspace tohoto projektu.
CREATE OR REPLACE FUNCTION watson_validate_task_status_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.status_id IS NULL THEN RETURN NEW; END IF;
	IF NOT EXISTS (
		SELECT 1
		FROM statuses s JOIN projects p ON p.id = NEW.project_id
		WHERE s.id = NEW.status_id
		  AND ((s.scope = 'project' AND s.project_id = NEW.project_id)
		       OR (s.scope = 'workspace' AND s.workspace_id = p.workspace_id))
	) THEN
		RAISE EXCEPTION 'task_status_outside_project_scope' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS validate_task_status_scope ON tasks;
--> statement-breakpoint
CREATE TRIGGER validate_task_status_scope
BEFORE INSERT OR UPDATE OF status_id, project_id ON tasks
FOR EACH ROW EXECUTE FUNCTION watson_validate_task_status_scope();
--> statement-breakpoint

-- Změna vlastníka/scope statusu nesmí zpětně zneplatnit již odkazující tasky.
CREATE OR REPLACE FUNCTION watson_guard_status_scope_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM tasks t JOIN projects p ON p.id = t.project_id
		WHERE t.status_id = OLD.id
		  AND NOT ((NEW.scope = 'project' AND NEW.project_id = t.project_id)
		           OR (NEW.scope = 'workspace' AND NEW.workspace_id = p.workspace_id))
	) THEN
		RAISE EXCEPTION 'status_scope_change_would_orphan_tasks' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_status_scope_change ON statuses;
--> statement-breakpoint
CREATE TRIGGER guard_status_scope_change
BEFORE UPDATE OF scope, project_id, workspace_id ON statuses
FOR EACH ROW EXECUTE FUNCTION watson_guard_status_scope_change();
--> statement-breakpoint

-- Meeting lifecycle je monotónní. Commit nelze vrátit PATCHem a žádný stav
-- nelze regresovat přes sync, worker ani budoucí endpoint.
CREATE OR REPLACE FUNCTION watson_guard_meeting_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	old_rank integer;
	new_rank integer;
BEGIN
	old_rank := CASE OLD.status WHEN 'new' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'transcribed' THEN 2 WHEN 'extracted' THEN 3 WHEN 'committed' THEN 4 END;
	new_rank := CASE NEW.status WHEN 'new' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'transcribed' THEN 2 WHEN 'extracted' THEN 3 WHEN 'committed' THEN 4 END;
	IF new_rank < old_rank THEN
		RAISE EXCEPTION 'meeting_status_regression' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS guard_meeting_transition ON meetings;
--> statement-breakpoint
CREATE TRIGGER guard_meeting_transition
BEFORE UPDATE OF status ON meetings
FOR EACH ROW EXECUTE FUNCTION watson_guard_meeting_transition();
--> statement-breakpoint

-- Soft backpointer task.meeting_id je validován deferred, protože plan/restore
-- vkládá task a meeting ve stejné transakci. Action task smí přežít delete meetingu,
-- ale BEFORE DELETE jej nejdřív atomicky odpojí.
CREATE OR REPLACE FUNCTION watson_validate_task_meeting_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.meeting_id IS NULL THEN RETURN NEW; END IF;
	IF NEW.meeting_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
		RAISE EXCEPTION 'task_meeting_id_not_uuid' USING ERRCODE = '23514';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM meetings m
		JOIN projects p ON p.id = NEW.project_id
		WHERE m.id = NEW.meeting_id::uuid
		  AND m.workspace_id = p.workspace_id
		  AND (NEW.kind <> 'meeting' OR m.hub_task_id = NEW.id)
	) THEN
		RAISE EXCEPTION 'task_meeting_link_invalid' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS validate_task_meeting_link ON tasks;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_task_meeting_link
AFTER INSERT OR UPDATE ON tasks
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION watson_validate_task_meeting_link();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION watson_validate_meeting_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.hub_task_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM tasks t JOIN projects p ON p.id = t.project_id
		WHERE t.id = NEW.hub_task_id AND t.kind = 'meeting'
		  AND t.meeting_id = NEW.id::text AND p.workspace_id = NEW.workspace_id
	) THEN
		RAISE EXCEPTION 'meeting_hub_link_invalid' USING ERRCODE = '23514';
	END IF;
	IF NEW.prev_meeting_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM meetings prev
		WHERE prev.id = NEW.prev_meeting_id
		  AND prev.workspace_id = NEW.workspace_id
		  AND NEW.series_id = COALESCE(prev.series_id, prev.id)
	) THEN
		RAISE EXCEPTION 'meeting_previous_link_invalid' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS validate_meeting_links ON meetings;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_meeting_links
AFTER INSERT OR UPDATE ON meetings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION watson_validate_meeting_links();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION watson_detach_meeting_soft_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	-- Přímý DELETE meetingu s existujícím hubem je zakázán; business delete začíná
	-- odstraněním hub tasku a sem dorazí přes FK cascade ve stejné transakci.
	IF OLD.hub_task_id IS NOT NULL AND EXISTS (SELECT 1 FROM tasks WHERE id = OLD.hub_task_id) THEN
		RAISE EXCEPTION 'meeting_delete_requires_hub_task_delete' USING ERRCODE = '23514';
	END IF;
	UPDATE tasks SET meeting_id = NULL
	WHERE meeting_id = OLD.id::text AND id IS DISTINCT FROM OLD.hub_task_id;
	UPDATE meetings SET prev_meeting_id = NULL
	WHERE prev_meeting_id = OLD.id;
	RETURN OLD;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS detach_meeting_soft_links ON meetings;
--> statement-breakpoint
CREATE TRIGGER detach_meeting_soft_links
BEFORE DELETE ON meetings
FOR EACH ROW EXECUTE FUNCTION watson_detach_meeting_soft_links();
