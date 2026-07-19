CREATE TABLE "task_poll_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"respondent_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"question" varchar(240) NOT NULL,
	"response_type" varchar(24) NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_polls_question_valid" CHECK (char_length(trim("task_polls"."question")) between 1 and 240),
	CONSTRAINT "task_polls_response_type_valid" CHECK ("task_polls"."response_type" in ('single_choice', 'multiple_choice', 'text', 'number', 'date')),
	CONSTRAINT "task_polls_options_valid" CHECK (jsonb_typeof("task_polls"."options") = 'array' and (
				("task_polls"."response_type" in ('single_choice', 'multiple_choice') and jsonb_array_length("task_polls"."options") between 2 and 20)
				or ("task_polls"."response_type" not in ('single_choice', 'multiple_choice') and "task_polls"."options" = '[]'::jsonb)
			))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "task_polls_id_task_project_uq" ON "task_polls" USING btree ("id","task_id","project_id");--> statement-breakpoint
ALTER TABLE "task_poll_responses" ADD CONSTRAINT "task_poll_responses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_poll_responses" ADD CONSTRAINT "task_poll_responses_respondent_id_users_id_fk" FOREIGN KEY ("respondent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_poll_responses" ADD CONSTRAINT "task_poll_responses_poll_scope_fk" FOREIGN KEY ("poll_id","task_id","project_id") REFERENCES "public"."task_polls"("id","task_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_polls" ADD CONSTRAINT "task_polls_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_polls" ADD CONSTRAINT "task_polls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_polls" ADD CONSTRAINT "task_polls_task_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_poll_responses_poll_respondent_uq" ON "task_poll_responses" USING btree ("poll_id","respondent_id");--> statement-breakpoint
CREATE INDEX "task_poll_responses_task_idx" ON "task_poll_responses" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_poll_responses_project_idx" ON "task_poll_responses" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "task_poll_responses_respondent_idx" ON "task_poll_responses" USING btree ("respondent_id");--> statement-breakpoint
CREATE INDEX "task_polls_task_idx" ON "task_polls" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_polls_project_idx" ON "task_polls" USING btree ("project_id");--> statement-breakpoint

CREATE OR REPLACE FUNCTION watson_validate_task_poll()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.question := trim(NEW.question);
	IF TG_OP = 'UPDATE' THEN
		IF NEW.task_id IS DISTINCT FROM OLD.task_id
			OR NEW.project_id IS DISTINCT FROM OLD.project_id
			OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
			RAISE EXCEPTION 'poll_scope_immutable' USING ERRCODE = '23514';
		END IF;
		IF EXISTS (SELECT 1 FROM task_poll_responses WHERE poll_id = OLD.id)
			AND (NEW.question IS DISTINCT FROM OLD.question
				OR NEW.response_type IS DISTINCT FROM OLD.response_type
				OR NEW.options IS DISTINCT FROM OLD.options) THEN
			RAISE EXCEPTION 'poll_locked_after_response' USING ERRCODE = '23514';
		END IF;
	END IF;

	IF NEW.response_type IN ('single_choice', 'multiple_choice') THEN
		IF EXISTS (
			SELECT 1
			FROM jsonb_array_elements(NEW.options) AS option_row(value)
			WHERE jsonb_typeof(option_row.value) <> 'object'
				OR jsonb_object_length(option_row.value) <> 2
				OR NOT (option_row.value ? 'id' AND option_row.value ? 'label')
				OR jsonb_typeof(option_row.value->'id') <> 'string'
				OR jsonb_typeof(option_row.value->'label') <> 'string'
				OR (option_row.value->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
				OR char_length(trim(option_row.value->>'label')) NOT BETWEEN 1 AND 120
		) THEN
			RAISE EXCEPTION 'poll_options_invalid' USING ERRCODE = '23514';
		END IF;
		IF EXISTS (
			SELECT 1 FROM jsonb_array_elements(NEW.options) AS option_row(value)
			GROUP BY lower(trim(option_row.value->>'label')) HAVING count(*) > 1
		) OR EXISTS (
			SELECT 1 FROM jsonb_array_elements(NEW.options) AS option_row(value)
			GROUP BY option_row.value->>'id' HAVING count(*) > 1
		) THEN
			RAISE EXCEPTION 'poll_options_duplicate' USING ERRCODE = '23514';
		END IF;
		SELECT jsonb_agg(
			jsonb_build_object('id', option_row.value->>'id', 'label', trim(option_row.value->>'label'))
			ORDER BY option_row.ordinality
		)
		INTO NEW.options
		FROM jsonb_array_elements(NEW.options) WITH ORDINALITY AS option_row(value, ordinality);
	ELSE
		NEW.options := '[]'::jsonb;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER task_polls_validate_trg
BEFORE INSERT OR UPDATE ON task_polls
FOR EACH ROW EXECUTE FUNCTION watson_validate_task_poll();--> statement-breakpoint

CREATE OR REPLACE FUNCTION watson_validate_task_poll_response()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	poll_row task_polls%ROWTYPE;
	text_value text;
BEGIN
	IF TG_OP = 'UPDATE' AND (
		NEW.poll_id IS DISTINCT FROM OLD.poll_id
		OR NEW.task_id IS DISTINCT FROM OLD.task_id
		OR NEW.project_id IS DISTINCT FROM OLD.project_id
		OR NEW.respondent_id IS DISTINCT FROM OLD.respondent_id
	) THEN
		RAISE EXCEPTION 'poll_response_scope_immutable' USING ERRCODE = '23514';
	END IF;

	SELECT * INTO poll_row FROM task_polls WHERE id = NEW.poll_id;
	IF NOT FOUND OR poll_row.task_id <> NEW.task_id OR poll_row.project_id <> NEW.project_id THEN
		RAISE EXCEPTION 'poll_response_scope_invalid' USING ERRCODE = '23514';
	END IF;
	IF current_setting('watson.allow_poll_restore', true) IS DISTINCT FROM 'on'
		AND poll_row.closed_at IS NOT NULL THEN
		RAISE EXCEPTION 'poll_closed' USING ERRCODE = '23514';
	END IF;
	IF current_setting('watson.allow_poll_restore', true) IS DISTINCT FROM 'on'
		AND NOT EXISTS (
		SELECT 1 FROM project_members
		WHERE project_id = NEW.project_id AND user_id = NEW.respondent_id
	) THEN
		RAISE EXCEPTION 'poll_respondent_not_member' USING ERRCODE = '23514';
	END IF;

	CASE poll_row.response_type
		WHEN 'single_choice' THEN
			IF jsonb_typeof(NEW.value) <> 'string' OR NOT EXISTS (
				SELECT 1 FROM jsonb_array_elements(poll_row.options) AS option_row(value)
				WHERE option_row.value->>'id' = NEW.value #>> '{}'
			) THEN
				RAISE EXCEPTION 'poll_response_invalid' USING ERRCODE = '23514';
			END IF;
		WHEN 'multiple_choice' THEN
			IF jsonb_typeof(NEW.value) <> 'array'
				OR jsonb_array_length(NEW.value) NOT BETWEEN 1 AND 20
				OR EXISTS (
					SELECT 1 FROM jsonb_array_elements(NEW.value) AS answer(value)
					WHERE jsonb_typeof(answer.value) <> 'string'
						OR NOT EXISTS (
							SELECT 1 FROM jsonb_array_elements(poll_row.options) AS option_row(value)
							WHERE option_row.value->>'id' = answer.value #>> '{}'
						)
				)
				OR EXISTS (
					SELECT 1 FROM jsonb_array_elements_text(NEW.value) AS answer(value)
					GROUP BY answer.value HAVING count(*) > 1
				) THEN
				RAISE EXCEPTION 'poll_response_invalid' USING ERRCODE = '23514';
			END IF;
		WHEN 'text' THEN
			text_value := NEW.value #>> '{}';
			IF jsonb_typeof(NEW.value) <> 'string'
				OR char_length(trim(COALESCE(text_value, ''))) NOT BETWEEN 1 AND 1000 THEN
				RAISE EXCEPTION 'poll_response_invalid' USING ERRCODE = '23514';
			END IF;
			NEW.value := to_jsonb(trim(text_value));
		WHEN 'number' THEN
			IF jsonb_typeof(NEW.value) <> 'number'
				OR abs((NEW.value #>> '{}')::numeric) > 1000000000000000 THEN
				RAISE EXCEPTION 'poll_response_invalid' USING ERRCODE = '23514';
			END IF;
		WHEN 'date' THEN
			text_value := NEW.value #>> '{}';
			IF jsonb_typeof(NEW.value) <> 'string'
				OR text_value !~ '^\d{4}-\d{2}-\d{2}$'
				OR to_char(to_date(text_value, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> text_value THEN
				RAISE EXCEPTION 'poll_response_invalid' USING ERRCODE = '23514';
			END IF;
	END CASE;
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER task_poll_responses_validate_trg
BEFORE INSERT OR UPDATE ON task_poll_responses
FOR EACH ROW EXECUTE FUNCTION watson_validate_task_poll_response();
