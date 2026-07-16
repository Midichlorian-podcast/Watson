CREATE TABLE "availability_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"label" varchar(160),
	"visibility" varchar(12) DEFAULT 'team' NOT NULL,
	"source" varchar(16) DEFAULT 'manual' NOT NULL,
	"external_id" varchar(240),
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_blocks_kind_valid" CHECK ("availability_blocks"."kind" in ('focus', 'unavailable', 'absence', 'holiday')),
	CONSTRAINT "availability_blocks_visibility_valid" CHECK ("availability_blocks"."visibility" in ('team', 'private')),
	CONSTRAINT "availability_blocks_source_valid" CHECK ("availability_blocks"."source" in ('manual', 'calendar', 'luckyos')),
	CONSTRAINT "availability_blocks_time_valid" CHECK ("availability_blocks"."ends_at" > "availability_blocks"."starts_at"),
	CONSTRAINT "availability_blocks_version_positive" CHECK ("availability_blocks"."version" >= 1),
	CONSTRAINT "availability_blocks_timezone_format" CHECK ("availability_blocks"."timezone" ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$')
);
--> statement-breakpoint
CREATE TABLE "availability_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"working_hours" jsonb DEFAULT '{"enabled":false,"days":[]}'::jsonb NOT NULL,
	"quiet_hours" jsonb DEFAULT '{"enabled":false,"days":[1,2,3,4,5,6,7],"startMinute":1320,"endMinute":420}'::jsonb NOT NULL,
	"manual_snooze_started_at" timestamp with time zone,
	"manual_snooze_until" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_profiles_json_shape" CHECK (jsonb_typeof("availability_profiles"."working_hours") = 'object' and jsonb_typeof("availability_profiles"."quiet_hours") = 'object'),
	CONSTRAINT "availability_profiles_version_positive" CHECK ("availability_profiles"."version" >= 1),
	CONSTRAINT "availability_profiles_snooze_shape" CHECK ("availability_profiles"."manual_snooze_until" is null or "availability_profiles"."manual_snooze_started_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_membership_fk" FOREIGN KEY ("user_id","workspace_id") REFERENCES "public"."memberships"("user_id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_profiles" ADD CONSTRAINT "availability_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_profiles" ADD CONSTRAINT "availability_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_profiles" ADD CONSTRAINT "availability_profiles_membership_fk" FOREIGN KEY ("user_id","workspace_id") REFERENCES "public"."memberships"("user_id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_blocks_workspace_time_idx" ON "availability_blocks" USING btree ("workspace_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "availability_blocks_user_time_idx" ON "availability_blocks" USING btree ("user_id","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "availability_blocks_external_uq" ON "availability_blocks" USING btree ("workspace_id","user_id","source","external_id") WHERE "availability_blocks"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "availability_profiles_workspace_user_uq" ON "availability_profiles" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "availability_profiles_user_idx" ON "availability_profiles" USING btree ("user_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_validate_availability_profile()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	day_item jsonb;
	interval_item jsonb;
	quiet_day jsonb;
	day_number integer;
	start_minute integer;
	end_minute integer;
	last_end integer;
	seen_days integer[] := ARRAY[]::integer[];
BEGIN
	IF jsonb_typeof(NEW.working_hours->'enabled') IS DISTINCT FROM 'boolean'
		OR jsonb_typeof(NEW.working_hours->'days') IS DISTINCT FROM 'array' THEN
		RAISE EXCEPTION 'availability_working_hours_shape_invalid' USING ERRCODE = '23514';
	END IF;
	IF jsonb_array_length(NEW.working_hours->'days') > 7 THEN
		RAISE EXCEPTION 'availability_working_hours_days_invalid' USING ERRCODE = '23514';
	END IF;
	FOR day_item IN SELECT value FROM jsonb_array_elements(NEW.working_hours->'days') LOOP
		IF jsonb_typeof(day_item) IS DISTINCT FROM 'object'
			OR jsonb_typeof(day_item->'day') IS DISTINCT FROM 'number'
			OR jsonb_typeof(day_item->'intervals') IS DISTINCT FROM 'array' THEN
			RAISE EXCEPTION 'availability_working_day_shape_invalid' USING ERRCODE = '23514';
		END IF;
		day_number := (day_item->>'day')::integer;
		IF day_number NOT BETWEEN 1 AND 7 OR day_number = ANY(seen_days)
			OR jsonb_array_length(day_item->'intervals') > 4 THEN
			RAISE EXCEPTION 'availability_working_day_invalid' USING ERRCODE = '23514';
		END IF;
		seen_days := array_append(seen_days, day_number);
		last_end := 0;
		FOR interval_item IN SELECT value FROM jsonb_array_elements(day_item->'intervals') LOOP
			IF jsonb_typeof(interval_item->'startMinute') IS DISTINCT FROM 'number'
				OR jsonb_typeof(interval_item->'endMinute') IS DISTINCT FROM 'number' THEN
				RAISE EXCEPTION 'availability_working_interval_shape_invalid' USING ERRCODE = '23514';
			END IF;
			start_minute := (interval_item->>'startMinute')::integer;
			end_minute := (interval_item->>'endMinute')::integer;
			IF start_minute < 0 OR end_minute > 1440 OR start_minute >= end_minute
				OR start_minute < last_end THEN
				RAISE EXCEPTION 'availability_working_interval_invalid' USING ERRCODE = '23514';
			END IF;
			last_end := end_minute;
		END LOOP;
	END LOOP;
	IF (NEW.working_hours->>'enabled')::boolean AND NOT EXISTS (
		SELECT 1 FROM jsonb_array_elements(NEW.working_hours->'days') AS d(value)
		WHERE jsonb_array_length(d.value->'intervals') > 0
	) THEN
		RAISE EXCEPTION 'availability_working_hours_empty' USING ERRCODE = '23514';
	END IF;

	IF jsonb_typeof(NEW.quiet_hours->'enabled') IS DISTINCT FROM 'boolean'
		OR jsonb_typeof(NEW.quiet_hours->'days') IS DISTINCT FROM 'array'
		OR jsonb_typeof(NEW.quiet_hours->'startMinute') IS DISTINCT FROM 'number'
		OR jsonb_typeof(NEW.quiet_hours->'endMinute') IS DISTINCT FROM 'number' THEN
		RAISE EXCEPTION 'availability_quiet_hours_shape_invalid' USING ERRCODE = '23514';
	END IF;
	IF jsonb_array_length(NEW.quiet_hours->'days') NOT BETWEEN 1 AND 7 THEN
		RAISE EXCEPTION 'availability_quiet_hours_days_invalid' USING ERRCODE = '23514';
	END IF;
	seen_days := ARRAY[]::integer[];
	FOR quiet_day IN SELECT value FROM jsonb_array_elements(NEW.quiet_hours->'days') LOOP
		IF jsonb_typeof(quiet_day) IS DISTINCT FROM 'number' THEN
			RAISE EXCEPTION 'availability_quiet_day_shape_invalid' USING ERRCODE = '23514';
		END IF;
		day_number := quiet_day::text::integer;
		IF day_number NOT BETWEEN 1 AND 7 OR day_number = ANY(seen_days) THEN
			RAISE EXCEPTION 'availability_quiet_day_invalid' USING ERRCODE = '23514';
		END IF;
		seen_days := array_append(seen_days, day_number);
	END LOOP;
	start_minute := (NEW.quiet_hours->>'startMinute')::integer;
	end_minute := (NEW.quiet_hours->>'endMinute')::integer;
	IF start_minute NOT BETWEEN 0 AND 1439 OR end_minute NOT BETWEEN 0 AND 1439
		OR start_minute = end_minute THEN
		RAISE EXCEPTION 'availability_quiet_hours_interval_invalid' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER availability_profiles_shape_guard
BEFORE INSERT OR UPDATE OF working_hours, quiet_hours ON availability_profiles
FOR EACH ROW EXECUTE FUNCTION watson_validate_availability_profile();
