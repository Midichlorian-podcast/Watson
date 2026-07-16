ALTER TABLE "booking_page_participants" DROP CONSTRAINT "booking_page_participants_project_member_fk";
--> statement-breakpoint
ALTER TABLE "booking_pages" DROP CONSTRAINT "booking_pages_organizer_project_member_fk";
--> statement-breakpoint
ALTER TABLE "booking_reservations" DROP CONSTRAINT "booking_reservations_booker_project_member_fk";
--> statement-breakpoint
ALTER TABLE "booking_reservations" ALTER COLUMN "booked_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_page_participants" ADD CONSTRAINT "booking_page_participants_project_member_fk" FOREIGN KEY ("project_id","user_id") REFERENCES "public"."project_members"("project_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reservations" ADD CONSTRAINT "booking_reservations_booked_by_users_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_booking_page_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'invalid booking timezone' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = NEW.project_id AND pm.user_id = NEW.organizer_id
  ) THEN
    RAISE EXCEPTION 'booking organizer must be project member' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER booking_pages_guard
BEFORE INSERT OR UPDATE OF project_id, organizer_id, timezone ON booking_pages
FOR EACH ROW EXECUTE FUNCTION watson_booking_page_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_booking_slot_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_duration integer;
BEGIN
  SELECT duration_min INTO expected_duration FROM booking_pages WHERE id = NEW.page_id;
  IF expected_duration IS NULL OR NEW.ends_at <> NEW.starts_at + expected_duration * interval '1 minute' THEN
    RAISE EXCEPTION 'booking slot duration mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER booking_slots_guard
BEFORE INSERT OR UPDATE OF page_id, starts_at, ends_at ON booking_slots
FOR EACH ROW EXECUTE FUNCTION watson_booking_slot_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_booking_reservation_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.booked_by IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.booked_by IS DISTINCT FROM OLD.booked_by) AND NOT EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = NEW.project_id AND pm.user_id = NEW.booked_by
  ) THEN
    RAISE EXCEPTION 'booking user must be project member' USING ERRCODE = '23514';
  END IF;
  IF NEW.meeting_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM booking_pages bp
    JOIN booking_slots bs ON bs.id = NEW.slot_id AND bs.page_id = bp.id
    JOIN meetings m ON m.id = NEW.meeting_id AND m.workspace_id = bp.workspace_id
    JOIN tasks t ON t.id = NEW.hub_task_id
      AND t.project_id = NEW.project_id
      AND t.meeting_id = NEW.meeting_id::text
      AND t.start_date = bs.starts_at
      AND t.duration_min = bp.duration_min
    WHERE bp.id = NEW.page_id AND bp.project_id = NEW.project_id
      AND m.hub_task_id = t.id
  ) THEN
    RAISE EXCEPTION 'booking reservation meeting mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER booking_reservations_guard
BEFORE INSERT OR UPDATE OF page_id, slot_id, project_id, booked_by, meeting_id, hub_task_id
ON booking_reservations FOR EACH ROW EXECUTE FUNCTION watson_booking_reservation_guard();
