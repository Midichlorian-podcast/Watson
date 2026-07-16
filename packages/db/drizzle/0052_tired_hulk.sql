CREATE TABLE "import_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_by" uuid,
	"source" varchar(24) NOT NULL,
	"source_name" varchar(255) NOT NULL,
	"source_fingerprint" varchar(64) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'imported' NOT NULL,
	"item_count" integer NOT NULL,
	"attachment_expected" integer DEFAULT 0 NOT NULL,
	"created_section_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_label_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rolled_back_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_source_valid" CHECK ("import_batches"."source" in ('csv', 'asana', 'trello', 'todoist')),
	CONSTRAINT "import_batches_status_valid" CHECK ("import_batches"."status" in ('imported', 'rolled_back')),
	CONSTRAINT "import_batches_status_shape" CHECK (("import_batches"."status" = 'imported' and "import_batches"."rolled_back_at" is null) or ("import_batches"."status" = 'rolled_back' and "import_batches"."rolled_back_at" is not null)),
	CONSTRAINT "import_batches_item_count_valid" CHECK ("import_batches"."item_count" between 1 and 2000),
	CONSTRAINT "import_batches_attachment_count_valid" CHECK ("import_batches"."attachment_expected" between 0 and 100000),
	CONSTRAINT "import_batches_fingerprint_valid" CHECK ("import_batches"."source_fingerprint" ~ '^[0-9a-f]{64}$' and "import_batches"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "import_batches_created_ids_shape" CHECK (jsonb_typeof("import_batches"."created_section_ids") = 'array' and jsonb_typeof("import_batches"."created_label_ids") = 'array')
);
--> statement-breakpoint
CREATE TABLE "import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"source_key" varchar(200) NOT NULL,
	"task_id" uuid,
	"task_name" varchar(500) NOT NULL,
	"assignee_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"label_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachment_expected" integer DEFAULT 0 NOT NULL,
	"task_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_items_attachment_count_valid" CHECK ("import_items"."attachment_expected" between 0 and 50),
	CONSTRAINT "import_items_json_shape" CHECK (jsonb_typeof("import_items"."assignee_ids") = 'array' and jsonb_typeof("import_items"."label_ids") = 'array')
);
--> statement-breakpoint
ALTER TABLE "import_attachments" ADD CONSTRAINT "import_attachments_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_attachments" ADD CONSTRAINT "import_attachments_item_id_import_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."import_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_attachments" ADD CONSTRAINT "import_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_attachments_attachment_uq" ON "import_attachments" USING btree ("attachment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_attachments_item_attachment_uq" ON "import_attachments" USING btree ("item_id","attachment_id");--> statement-breakpoint
CREATE INDEX "import_attachments_batch_idx" ON "import_attachments" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_id_project_uq" ON "import_batches" USING btree ("id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_source_active_uq" ON "import_batches" USING btree ("project_id","source_fingerprint") WHERE "import_batches"."rolled_back_at" is null;--> statement-breakpoint
CREATE INDEX "import_batches_workspace_idx" ON "import_batches" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "import_batches_project_idx" ON "import_batches" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_items_batch_source_uq" ON "import_items" USING btree ("batch_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "import_items_task_uq" ON "import_items" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_items_id_batch_uq" ON "import_items" USING btree ("id","batch_id");--> statement-breakpoint
CREATE INDEX "import_items_batch_idx" ON "import_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "import_items_project_idx" ON "import_items" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_batch_project_fk" FOREIGN KEY ("batch_id","project_id") REFERENCES "public"."import_batches"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_attachments" ADD CONSTRAINT "import_attachments_item_batch_fk" FOREIGN KEY ("item_id","batch_id") REFERENCES "public"."import_items"("id","batch_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_validate_import_batch_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM projects p
		WHERE p.id = NEW.project_id AND p.workspace_id = NEW.workspace_id
	) THEN
		RAISE EXCEPTION 'import_batch_scope_invalid' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER import_batches_scope_guard
BEFORE INSERT OR UPDATE OF workspace_id, project_id ON import_batches
FOR EACH ROW EXECUTE FUNCTION watson_validate_import_batch_scope();--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_validate_import_item_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.task_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM tasks t WHERE t.id = NEW.task_id AND t.project_id = NEW.project_id
	) THEN
		RAISE EXCEPTION 'import_item_task_scope_invalid' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER import_items_scope_guard
BEFORE INSERT OR UPDATE OF project_id, task_id ON import_items
FOR EACH ROW EXECUTE FUNCTION watson_validate_import_item_scope();--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_validate_import_attachment_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM import_items item
		JOIN attachments attachment ON attachment.id = NEW.attachment_id
		WHERE item.id = NEW.item_id
		  AND item.batch_id = NEW.batch_id
		  AND item.task_id = attachment.task_id
	) THEN
		RAISE EXCEPTION 'import_attachment_scope_invalid' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER import_attachments_scope_guard
BEFORE INSERT OR UPDATE OF batch_id, item_id, attachment_id ON import_attachments
FOR EACH ROW EXECUTE FUNCTION watson_validate_import_attachment_scope();
