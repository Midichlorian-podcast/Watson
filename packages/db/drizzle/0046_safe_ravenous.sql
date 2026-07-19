CREATE TABLE "project_custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"field_type" varchar(16) NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_custom_fields_name_valid" CHECK (char_length(trim("project_custom_fields"."name")) between 1 and 120),
	CONSTRAINT "project_custom_fields_type_valid" CHECK ("project_custom_fields"."field_type" in ('text', 'number', 'select', 'date', 'checkbox', 'url', 'person')),
	CONSTRAINT "project_custom_fields_position_valid" CHECK ("project_custom_fields"."position" >= 0),
	CONSTRAINT "project_custom_fields_options_valid" CHECK (jsonb_typeof("project_custom_fields"."options") = 'array' and (
				("project_custom_fields"."field_type" = 'select' and jsonb_array_length("project_custom_fields"."options") between 2 and 50)
				or ("project_custom_fields"."field_type" <> 'select' and "project_custom_fields"."options" = '[]'::jsonb)
			))
);
--> statement-breakpoint
CREATE TABLE "task_custom_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "project_custom_fields_id_project_uq" ON "project_custom_fields" USING btree ("id","project_id");--> statement-breakpoint
ALTER TABLE "project_custom_fields" ADD CONSTRAINT "project_custom_fields_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_custom_fields" ADD CONSTRAINT "project_custom_fields_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_custom_field_values" ADD CONSTRAINT "task_custom_field_values_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_custom_field_values" ADD CONSTRAINT "task_custom_field_values_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_custom_field_values" ADD CONSTRAINT "task_custom_field_values_field_project_fk" FOREIGN KEY ("field_id","project_id") REFERENCES "public"."project_custom_fields"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_custom_field_values" ADD CONSTRAINT "task_custom_field_values_task_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_custom_fields_name_uq" ON "project_custom_fields" USING btree ("project_id",lower("name"));--> statement-breakpoint
CREATE INDEX "project_custom_fields_project_idx" ON "project_custom_fields" USING btree ("project_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "task_custom_field_values_task_field_uq" ON "task_custom_field_values" USING btree ("task_id","field_id");--> statement-breakpoint
CREATE INDEX "task_custom_field_values_task_idx" ON "task_custom_field_values" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_custom_field_values_project_idx" ON "task_custom_field_values" USING btree ("project_id");--> statement-breakpoint

-- Definice pole musí zůstat kanonická i při restore nebo přímém serverovém zápisu.
CREATE OR REPLACE FUNCTION watson_validate_custom_field_definition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	option_count integer;
	valid_count integer;
BEGIN
	NEW.name := trim(NEW.name);
	IF NEW.field_type = 'select' THEN
		SELECT count(*) INTO option_count FROM jsonb_array_elements(NEW.options);
		SELECT count(*) INTO valid_count
		FROM jsonb_array_elements(NEW.options) option
		WHERE jsonb_typeof(option) = 'object'
		  AND option ? 'id' AND option ? 'label'
		  AND (SELECT count(*) FROM jsonb_object_keys(option)) = 2
		  AND option->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
		  AND char_length(trim(option->>'label')) BETWEEN 1 AND 120;
		IF option_count <> valid_count OR
		   (SELECT count(DISTINCT option->>'id') FROM jsonb_array_elements(NEW.options) option) <> option_count OR
		   (SELECT count(DISTINCT lower(trim(option->>'label'))) FROM jsonb_array_elements(NEW.options) option) <> option_count THEN
			RAISE EXCEPTION 'invalid custom field options' USING ERRCODE = '23514';
		END IF;
		NEW.options := (
			SELECT jsonb_agg(jsonb_build_object('id', option->>'id', 'label', trim(option->>'label')))
			FROM jsonb_array_elements(NEW.options) option
		);
	END IF;
	IF TG_OP = 'UPDATE' AND OLD.field_type <> NEW.field_type AND EXISTS (
		SELECT 1 FROM task_custom_field_values WHERE field_id = NEW.id
	) THEN
		RAISE EXCEPTION 'custom field type in use' USING ERRCODE = '23514';
	END IF;
	IF TG_OP = 'UPDATE' AND NEW.field_type = 'select' AND NEW.options <> OLD.options AND EXISTS (
		SELECT 1
		FROM task_custom_field_values value_row
		WHERE value_row.field_id = NEW.id
		  AND NOT EXISTS (
			SELECT 1 FROM jsonb_array_elements(NEW.options) option
			WHERE option->>'id' = value_row.value #>> '{}'
		  )
	) THEN
		RAISE EXCEPTION 'custom field option in use' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER project_custom_fields_validate_trg
BEFORE INSERT OR UPDATE ON project_custom_fields
FOR EACH ROW EXECUTE FUNCTION watson_validate_custom_field_definition();--> statement-breakpoint

-- Přesný runtime typ hodnoty a referenční integrita pro select/person jsou DB invariant.
CREATE OR REPLACE FUNCTION watson_validate_task_custom_field_value()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	definition project_custom_fields%ROWTYPE;
	scalar text;
BEGIN
	SELECT * INTO definition
	FROM project_custom_fields
	WHERE id = NEW.field_id AND project_id = NEW.project_id;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'custom field not found in project' USING ERRCODE = '23503';
	END IF;
	scalar := NEW.value #>> '{}';
	CASE definition.field_type
		WHEN 'text' THEN
			IF jsonb_typeof(NEW.value) <> 'string' OR char_length(scalar) > 4000 THEN
				RAISE EXCEPTION 'invalid text custom field value' USING ERRCODE = '23514';
			END IF;
		WHEN 'number' THEN
			IF jsonb_typeof(NEW.value) <> 'number' OR (scalar::numeric NOT BETWEEN -1000000000000000 AND 1000000000000000) THEN
				RAISE EXCEPTION 'invalid number custom field value' USING ERRCODE = '23514';
			END IF;
		WHEN 'select' THEN
			IF jsonb_typeof(NEW.value) <> 'string' OR NOT EXISTS (
				SELECT 1 FROM jsonb_array_elements(definition.options) option WHERE option->>'id' = scalar
			) THEN
				RAISE EXCEPTION 'invalid select custom field value' USING ERRCODE = '23514';
			END IF;
		WHEN 'date' THEN
			IF jsonb_typeof(NEW.value) <> 'string' OR scalar !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
			   OR to_char(to_date(scalar, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> scalar THEN
				RAISE EXCEPTION 'invalid date custom field value' USING ERRCODE = '23514';
			END IF;
		WHEN 'checkbox' THEN
			IF jsonb_typeof(NEW.value) <> 'boolean' THEN
				RAISE EXCEPTION 'invalid checkbox custom field value' USING ERRCODE = '23514';
			END IF;
		WHEN 'url' THEN
			IF jsonb_typeof(NEW.value) <> 'string' OR char_length(scalar) > 2048
			   OR scalar !~* '^https?://[^[:space:]]+$' THEN
				RAISE EXCEPTION 'invalid URL custom field value' USING ERRCODE = '23514';
			END IF;
		WHEN 'person' THEN
			IF jsonb_typeof(NEW.value) <> 'string'
			   OR scalar !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
			   OR NOT EXISTS (
				SELECT 1 FROM project_members WHERE project_id = NEW.project_id AND user_id = scalar::uuid
			   ) THEN
				RAISE EXCEPTION 'invalid person custom field value' USING ERRCODE = '23514';
			END IF;
	END CASE;
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER task_custom_field_values_validate_trg
BEFORE INSERT OR UPDATE ON task_custom_field_values
FOR EACH ROW EXECUTE FUNCTION watson_validate_task_custom_field_value();
