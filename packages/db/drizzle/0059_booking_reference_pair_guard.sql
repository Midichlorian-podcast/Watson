-- Reservation history keeps meeting_id and hub_task_id as an inseparable pair.
-- PostgreSQL executes independent ON DELETE SET NULL constraints one at a time,
-- so detach both references before either parent row disappears.
CREATE OR REPLACE FUNCTION watson_detach_booking_reservation_from_meeting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	UPDATE booking_reservations
	SET meeting_id = NULL, hub_task_id = NULL, updated_at = now()
	WHERE meeting_id = OLD.id;
	RETURN OLD;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS booking_reservations_detach_meeting_before_delete ON meetings;
--> statement-breakpoint
CREATE TRIGGER booking_reservations_detach_meeting_before_delete
BEFORE DELETE ON meetings
FOR EACH ROW EXECUTE FUNCTION watson_detach_booking_reservation_from_meeting();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_detach_booking_reservation_from_hub()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	UPDATE booking_reservations
	SET meeting_id = NULL, hub_task_id = NULL, updated_at = now()
	WHERE hub_task_id = OLD.id;
	RETURN OLD;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS booking_reservations_detach_hub_before_delete ON tasks;
--> statement-breakpoint
CREATE TRIGGER booking_reservations_detach_hub_before_delete
BEFORE DELETE ON tasks
FOR EACH ROW EXECUTE FUNCTION watson_detach_booking_reservation_from_hub();
