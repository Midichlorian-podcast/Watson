ALTER TABLE "task_poll_responses" ADD CONSTRAINT "task_poll_responses_value_shape" CHECK (jsonb_typeof("task_poll_responses"."value") in ('string', 'number', 'array'));--> statement-breakpoint

-- 0047 používala jsonb_object_length(), které v cílovém PostgreSQL není dostupné.
-- API i canonicalizace níže přebytečné klíče zahodí, takže validujeme povinné
-- id/label a funkci opravujeme výhradně forward migrací.
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
$$;
