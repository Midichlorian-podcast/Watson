-- Serialize availability changes with assignment/schedule checks per workspace + user.
-- This closes the READ COMMITTED race where a Focus block and a new assignment could
-- otherwise commit concurrently without seeing one another. Creating Focus over an
-- already committed task remains allowed by design; it never retroactively deletes work.
CREATE OR REPLACE FUNCTION watson_lock_availability_scope(p_workspace_id uuid, p_user_id uuid)
RETURNS void LANGUAGE sql AS $$
	SELECT pg_advisory_xact_lock(
		hashtextextended(format('availability:%s:%s', p_workspace_id, p_user_id), 0)
	)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_lock_availability_block()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	PERFORM watson_lock_availability_scope(NEW.workspace_id, NEW.user_id);
	IF TG_OP = 'UPDATE'
		AND (OLD.workspace_id, OLD.user_id) IS DISTINCT FROM (NEW.workspace_id, NEW.user_id) THEN
		PERFORM watson_lock_availability_scope(OLD.workspace_id, OLD.user_id);
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER availability_blocks_scope_lock
BEFORE INSERT OR UPDATE OF workspace_id, user_id, starts_at, ends_at, cancelled_at
ON availability_blocks
FOR EACH ROW EXECUTE FUNCTION watson_lock_availability_block();
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
	PERFORM watson_lock_availability_scope(task_workspace, p_user_id);

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
