-- Přímý business DELETE sidecaru zůstává zakázaný. Při FK cascade z hub tasku
-- nebo workspace/project cleanupu je však trigger vnořený (depth > 1) a nesmí
-- blokovat legitimní referenční úklid.
CREATE OR REPLACE FUNCTION watson_detach_meeting_soft_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF pg_trigger_depth() = 1
	   AND OLD.hub_task_id IS NOT NULL
	   AND EXISTS (SELECT 1 FROM tasks WHERE id = OLD.hub_task_id) THEN
		RAISE EXCEPTION 'meeting_delete_requires_hub_task_delete' USING ERRCODE = '23514';
	END IF;
	UPDATE tasks SET meeting_id = NULL
	WHERE meeting_id = OLD.id::text AND id IS DISTINCT FROM OLD.hub_task_id;
	UPDATE meetings SET prev_meeting_id = NULL
	WHERE prev_meeting_id = OLD.id;
	RETURN OLD;
END;
$$;
