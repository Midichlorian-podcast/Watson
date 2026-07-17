CREATE TABLE "decision_command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"operation_id" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"action" varchar(24) NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_receipts_hash_valid" CHECK ("decision_command_receipts"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "decision_receipts_action_valid" CHECK ("decision_command_receipts"."action" in ('create', 'review')),
	CONSTRAINT "decision_receipts_response_object" CHECK (jsonb_typeof("decision_command_receipts"."response") = 'object')
);
--> statement-breakpoint
CREATE TABLE "decision_task_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"source_type" varchar(24) NOT NULL,
	"source_object_id" uuid,
	"source_key" varchar(128) DEFAULT '0' NOT NULL,
	"title" text NOT NULL,
	"rationale" text,
	"owner_user_id" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone,
	"review_at" timestamp with time zone,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"supersedes_id" uuid,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_source_type_valid" CHECK ("decisions"."source_type" in ('manual', 'comment', 'meeting')),
	CONSTRAINT "decisions_source_consistent" CHECK (("decisions"."source_type" = 'manual' AND "decisions"."source_object_id" IS NULL) OR ("decisions"."source_type" <> 'manual' AND "decisions"."source_object_id" IS NOT NULL)),
	CONSTRAINT "decisions_source_key_valid" CHECK (length("decisions"."source_key") between 1 and 128),
	CONSTRAINT "decisions_title_valid" CHECK (length(trim("decisions"."title")) between 1 and 2000),
	CONSTRAINT "decisions_rationale_valid" CHECK ("decisions"."rationale" IS NULL OR length("decisions"."rationale") <= 10000),
	CONSTRAINT "decisions_status_valid" CHECK ("decisions"."status" in ('active', 'superseded', 'withdrawn')),
	CONSTRAINT "decisions_not_self_supersede" CHECK ("decisions"."supersedes_id" IS NULL OR "decisions"."supersedes_id" <> "decisions"."id"),
	CONSTRAINT "decisions_version_positive" CHECK ("decisions"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_id_project_uq" ON "decisions" USING btree ("id","project_id");--> statement-breakpoint
ALTER TABLE "decision_command_receipts" ADD CONSTRAINT "decision_command_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_command_receipts" ADD CONSTRAINT "decision_command_receipts_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_task_links" ADD CONSTRAINT "decision_task_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_task_links" ADD CONSTRAINT "decision_task_links_decision_project_fk" FOREIGN KEY ("decision_id","project_id") REFERENCES "public"."decisions"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_task_links" ADD CONSTRAINT "decision_task_links_task_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_supersedes_id_decisions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_project_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_receipts_actor_operation_uq" ON "decision_command_receipts" USING btree ("actor_user_id","operation_id");--> statement-breakpoint
CREATE INDEX "decision_receipts_workspace_idx" ON "decision_command_receipts" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_task_links_pair_uq" ON "decision_task_links" USING btree ("decision_id","task_id");--> statement-breakpoint
CREATE INDEX "decision_task_links_task_idx" ON "decision_task_links" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "decision_task_links_project_idx" ON "decision_task_links" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_source_uq" ON "decisions" USING btree ("source_type","source_object_id","source_key") WHERE "decisions"."source_object_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "decisions_project_status_idx" ON "decisions" USING btree ("project_id","status","decided_at");--> statement-breakpoint
CREATE INDEX "decisions_workspace_review_idx" ON "decisions" USING btree ("workspace_id","review_at");--> statement-breakpoint
CREATE INDEX "decisions_owner_idx" ON "decisions" USING btree ("owner_user_id","status");--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_decision_scope_and_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	project_workspace uuid;
	prior record;
BEGIN
	SELECT workspace_id INTO project_workspace FROM projects WHERE id = NEW.project_id;
	IF NOT FOUND OR project_workspace <> NEW.workspace_id THEN
		RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'decision_project_workspace_mismatch';
	END IF;
	IF NEW.owner_user_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM project_members
		WHERE project_id = NEW.project_id AND user_id = NEW.owner_user_id
	) THEN
		RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'decision_owner_not_project_member';
	END IF;
	IF TG_OP = 'INSERT' AND NEW.created_by IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM project_members
		WHERE project_id = NEW.project_id AND user_id = NEW.created_by
	) THEN
		RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'decision_creator_not_project_member';
	END IF;
	IF TG_OP = 'INSERT' AND NEW.source_type = 'comment' AND NOT EXISTS (
		SELECT 1 FROM comment_decisions cd
		WHERE cd.id = NEW.source_object_id AND cd.project_id = NEW.project_id
	) THEN
		RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'decision_comment_source_mismatch';
	END IF;
	IF TG_OP = 'INSERT' AND NEW.source_type = 'meeting' AND NOT EXISTS (
		SELECT 1
		FROM meetings m
		LEFT JOIN tasks hub ON hub.id = m.hub_task_id
		WHERE m.id = NEW.source_object_id
		  AND m.workspace_id = NEW.workspace_id
		  AND (hub.id IS NULL OR hub.project_id = NEW.project_id)
	) THEN
		RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'decision_meeting_source_mismatch';
	END IF;
	IF TG_OP = 'INSERT' AND NEW.supersedes_id IS NOT NULL THEN
		SELECT id, project_id, status INTO prior FROM decisions WHERE id = NEW.supersedes_id;
		IF NOT FOUND OR prior.project_id <> NEW.project_id OR prior.status <> 'active' THEN
			RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'decision_supersedes_invalid';
		END IF;
	END IF;
	IF TG_OP = 'UPDATE' THEN
		IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
			OR NEW.project_id IS DISTINCT FROM OLD.project_id
			OR NEW.source_type IS DISTINCT FROM OLD.source_type
			OR NEW.source_object_id IS DISTINCT FROM OLD.source_object_id
			OR NEW.source_key IS DISTINCT FROM OLD.source_key
			OR NEW.title IS DISTINCT FROM OLD.title
			OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
			OR NEW.created_by IS DISTINCT FROM OLD.created_by
			OR NEW.decided_at IS DISTINCT FROM OLD.decided_at THEN
			RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'decision_source_immutable';
		END IF;
		IF NEW.version <> OLD.version + 1 THEN
			RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'decision_version_invalid';
		END IF;
		IF OLD.status IN ('superseded', 'withdrawn') AND NEW.status <> OLD.status THEN
			RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'decision_terminal_status';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER decisions_scope_lifecycle_guard
BEFORE INSERT OR UPDATE ON decisions
FOR EACH ROW EXECUTE FUNCTION enforce_decision_scope_and_lifecycle();--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_decision_receipt_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM memberships
		WHERE workspace_id = NEW.workspace_id AND user_id = NEW.actor_user_id
	) THEN
		RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'decision_receipt_actor_scope_mismatch';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER decision_receipts_scope_guard
BEFORE INSERT OR UPDATE ON decision_command_receipts
FOR EACH ROW EXECUTE FUNCTION enforce_decision_receipt_scope();--> statement-breakpoint

CREATE OR REPLACE FUNCTION materialize_comment_decision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	comment_row record;
	canonical_id uuid;
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF current_setting('watson.skip_decision_materialize', true) = 'on' THEN
			RETURN NEW;
		END IF;
		SELECT c.body, p.workspace_id INTO comment_row
		FROM comments c
		JOIN projects p ON p.id = c.project_id
		WHERE c.id = NEW.comment_id AND c.task_id = NEW.task_id AND c.project_id = NEW.project_id;
		IF NOT FOUND THEN
			RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'decision_comment_source_mismatch';
		END IF;
		INSERT INTO decisions (
			id, workspace_id, project_id, source_type, source_object_id, source_key,
			title, decided_at, created_by
		) VALUES (
			NEW.id, comment_row.workspace_id, NEW.project_id, 'comment', NEW.id, '0',
			COALESCE(NULLIF(trim(left(comment_row.body, 2000)), ''), 'Rozhodnutí z komentáře'),
			NEW.created_at, NEW.marked_by
		) ON CONFLICT (source_type, source_object_id, source_key)
		WHERE source_object_id IS NOT NULL DO NOTHING;
		SELECT id INTO canonical_id FROM decisions
		WHERE source_type = 'comment' AND source_object_id = NEW.id AND source_key = '0';
		INSERT INTO decision_task_links (decision_id, task_id, project_id)
		VALUES (canonical_id, NEW.task_id, NEW.project_id)
		ON CONFLICT (decision_id, task_id) DO NOTHING;
		RETURN NEW;
	END IF;
	IF current_setting('watson.preserve_decisions_on_source_delete', true) = 'on' THEN
		RETURN OLD;
	END IF;
	UPDATE decisions
	SET status = 'withdrawn', version = version + 1, updated_at = now()
	WHERE source_type = 'comment' AND source_object_id = OLD.id AND status = 'active';
	RETURN OLD;
END;
$$;--> statement-breakpoint

INSERT INTO decisions (
	id, workspace_id, project_id, source_type, source_object_id, source_key,
	title, decided_at, created_by
)
SELECT cd.id, p.workspace_id, cd.project_id, 'comment', cd.id, '0',
	COALESCE(NULLIF(trim(left(c.body, 2000)), ''), 'Rozhodnutí z komentáře'),
	cd.created_at, cd.marked_by
FROM comment_decisions cd
JOIN comments c ON c.id = cd.comment_id
JOIN projects p ON p.id = cd.project_id
ON CONFLICT (source_type, source_object_id, source_key)
WHERE source_object_id IS NOT NULL DO NOTHING;--> statement-breakpoint

INSERT INTO decision_task_links (decision_id, task_id, project_id)
SELECT d.id, cd.task_id, cd.project_id
FROM comment_decisions cd
JOIN decisions d
	ON d.source_type = 'comment' AND d.source_object_id = cd.id AND d.source_key = '0'
ON CONFLICT (decision_id, task_id) DO NOTHING;--> statement-breakpoint

CREATE TRIGGER comment_decisions_materialize_log
AFTER INSERT OR DELETE ON comment_decisions
FOR EACH ROW EXECUTE FUNCTION materialize_comment_decision();
