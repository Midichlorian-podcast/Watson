CREATE TABLE "task_recurrence_prefixes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"anchor_date" date NOT NULL,
	"end_date" date NOT NULL,
	"recurrence_rule" text NOT NULL,
	"start_date" timestamp with time zone,
	"start_timezone" varchar(64),
	"duration_min" integer,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_recurrence_prefixes_range" CHECK ("task_recurrence_prefixes"."anchor_date" <= "task_recurrence_prefixes"."end_date"),
	CONSTRAINT "task_recurrence_prefixes_rule_object" CHECK (jsonb_typeof("task_recurrence_prefixes"."recurrence_rule"::jsonb) = 'object' and ("task_recurrence_prefixes"."recurrence_rule"::jsonb ? 'kind')),
	CONSTRAINT "task_recurrence_prefixes_start_timezone_pair" CHECK (("task_recurrence_prefixes"."start_date" is null) = ("task_recurrence_prefixes"."start_timezone" is null)),
	CONSTRAINT "task_recurrence_prefixes_timezone_format" CHECK ("task_recurrence_prefixes"."start_timezone" is null or "task_recurrence_prefixes"."start_timezone" ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$'),
	CONSTRAINT "task_recurrence_prefixes_duration_positive" CHECK ("task_recurrence_prefixes"."duration_min" is null or "task_recurrence_prefixes"."duration_min" between 1 and 10080),
	CONSTRAINT "task_recurrence_prefixes_version_positive" CHECK ("task_recurrence_prefixes"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "task_recurrence_prefixes" ADD CONSTRAINT "task_recurrence_prefixes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recurrence_prefixes" ADD CONSTRAINT "task_recurrence_prefixes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recurrence_prefixes" ADD CONSTRAINT "task_recurrence_prefixes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recurrence_prefixes" ADD CONSTRAINT "task_recurrence_prefixes_task_same_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_recurrence_prefixes_task_range_idx" ON "task_recurrence_prefixes" USING btree ("task_id","anchor_date","end_date");--> statement-breakpoint
CREATE INDEX "task_recurrence_prefixes_project_idx" ON "task_recurrence_prefixes" USING btree ("project_id");