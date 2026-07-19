ALTER TABLE "tasks" ADD COLUMN "start_timezone" varchar(64);
--> statement-breakpoint
-- Starší běžné úkoly vznikaly z ISO řetězce bez offsetu: PostgreSQL jej četl jako UTC,
-- přestože UI zamýšlelo Europe/Prague wall-clock. Meeting command už posílal pravý UTC
-- instant, proto se historický posun opravuje jen pro kind='task'. DDL drží ACCESS EXCLUSIVE
-- lock. Uživatelské validační triggery se během tohoto jednoho atomického backfillu vypnou,
-- protože jinak jejich pending AFTER events brání následnému ALTER TABLE; FK triggery zůstávají.
ALTER TABLE "tasks" DISABLE TRIGGER USER;
--> statement-breakpoint
UPDATE "tasks"
SET "start_date" = CASE
      WHEN "kind" = 'task' THEN ("start_date" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague'
      ELSE "start_date"
    END,
    "start_timezone" = 'Europe/Prague'
WHERE "start_date" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE TRIGGER USER;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_start_timezone_pair"
CHECK (("start_date" IS NULL) = ("start_timezone" IS NULL));
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_start_timezone_format"
CHECK ("start_timezone" IS NULL OR "start_timezone" ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$');
