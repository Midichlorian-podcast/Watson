-- Ruční UPDATE stejné tabulky v BEFORE DELETE triggeru kolidoval s FK cascade
-- při mazání celého workspace (SQLSTATE 27000: tuple already modified). Self-link
-- je skutečná reference, proto jej spravuje PostgreSQL přes ON DELETE SET NULL.
UPDATE meetings next
SET prev_meeting_id = NULL
WHERE prev_meeting_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM meetings prev WHERE prev.id = next.prev_meeting_id);
--> statement-breakpoint
ALTER TABLE meetings
ADD CONSTRAINT meetings_prev_meeting_id_meetings_id_fk
FOREIGN KEY (prev_meeting_id) REFERENCES meetings(id)
ON DELETE SET NULL
DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
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
	-- tasks.meeting_id je historicky textový soft-link; zachované action tasky
	-- odpojíme zde. meetings.prev_meeting_id už bezpečně řeší FK SET NULL.
	UPDATE tasks SET meeting_id = NULL
	WHERE meeting_id = OLD.id::text AND id IS DISTINCT FROM OLD.hub_task_id;
	RETURN OLD;
END;
$$;
