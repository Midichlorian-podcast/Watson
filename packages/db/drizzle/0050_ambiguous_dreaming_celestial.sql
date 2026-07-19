CREATE TABLE "intake_form_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"label" varchar(120) NOT NULL,
	"field_type" varchar(16) NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_form_fields_label_valid" CHECK (char_length(trim("intake_form_fields"."label")) between 1 and 120),
	CONSTRAINT "intake_form_fields_type_valid" CHECK ("intake_form_fields"."field_type" in ('text', 'textarea', 'number', 'date', 'select', 'checkbox')),
	CONSTRAINT "intake_form_fields_position_valid" CHECK ("intake_form_fields"."position" between 0 and 99),
	CONSTRAINT "intake_form_fields_options_valid" CHECK (jsonb_typeof("intake_form_fields"."options") = 'array' and (
				("intake_form_fields"."field_type" = 'select' and jsonb_array_length("intake_form_fields"."options") between 2 and 20)
				or ("intake_form_fields"."field_type" <> 'select' and "intake_form_fields"."options" = '[]'::jsonb)
			))
);
--> statement-breakpoint
CREATE TABLE "intake_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" text,
	"default_priority" integer DEFAULT 3 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_forms_title_valid" CHECK (char_length(trim("intake_forms"."title")) between 1 and 160),
	CONSTRAINT "intake_forms_priority_valid" CHECK ("intake_forms"."default_priority" between 1 and 4),
	CONSTRAINT "intake_forms_description_valid" CHECK ("intake_forms"."description" is null or char_length("intake_forms"."description") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "intake_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"submitted_by" uuid,
	"form_snapshot" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_submissions_snapshot_object" CHECK (jsonb_typeof("intake_submissions"."form_snapshot") = 'object'),
	CONSTRAINT "intake_submissions_answers_object" CHECK (jsonb_typeof("intake_submissions"."answers") = 'object')
);
--> statement-breakpoint
ALTER TABLE "intake_form_fields" ADD CONSTRAINT "intake_form_fields_form_id_intake_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."intake_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_forms" ADD CONSTRAINT "intake_forms_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_forms" ADD CONSTRAINT "intake_forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_submissions" ADD CONSTRAINT "intake_submissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_submissions" ADD CONSTRAINT "intake_submissions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_submissions" ADD CONSTRAINT "intake_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intake_forms_id_project_uq" ON "intake_forms" USING btree ("id","project_id");--> statement-breakpoint
ALTER TABLE "intake_submissions" ADD CONSTRAINT "intake_submissions_form_project_fk" FOREIGN KEY ("form_id","project_id") REFERENCES "public"."intake_forms"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intake_form_fields_form_position_uq" ON "intake_form_fields" USING btree ("form_id","position");--> statement-breakpoint
CREATE INDEX "intake_form_fields_form_idx" ON "intake_form_fields" USING btree ("form_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "intake_forms_title_uq" ON "intake_forms" USING btree ("project_id",lower("title"));--> statement-breakpoint
CREATE INDEX "intake_forms_project_idx" ON "intake_forms" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "intake_submissions_task_uq" ON "intake_submissions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "intake_submissions_form_idx" ON "intake_submissions" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE INDEX "intake_submissions_submitter_idx" ON "intake_submissions" USING btree ("submitted_by","created_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_validate_intake_submission_task()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.task_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM tasks t WHERE t.id = NEW.task_id AND t.project_id = NEW.project_id
	) THEN
		RAISE EXCEPTION 'intake_submission_task_project_mismatch' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER intake_submissions_task_project_guard
BEFORE INSERT OR UPDATE OF task_id, project_id ON intake_submissions
FOR EACH ROW EXECUTE FUNCTION watson_validate_intake_submission_task();
