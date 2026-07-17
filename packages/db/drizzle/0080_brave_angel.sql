CREATE TABLE "knowledge_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"article_version" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_acknowledgements_version_positive" CHECK ("knowledge_acknowledgements"."article_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "knowledge_article_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"draft_revision" integer NOT NULL,
	"article_type" varchar(16) NOT NULL,
	"title" varchar(200) NOT NULL,
	"summary" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sections" jsonb NOT NULL,
	"audience" varchar(32) NOT NULL,
	"acknowledgement_required" boolean NOT NULL,
	"owner_user_id" uuid,
	"change_note" varchar(500),
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_versions_version_positive" CHECK ("knowledge_article_versions"."version" > 0),
	CONSTRAINT "knowledge_versions_draft_revision_positive" CHECK ("knowledge_article_versions"."draft_revision" > 0),
	CONSTRAINT "knowledge_versions_type_valid" CHECK ("knowledge_article_versions"."article_type" in ('guide', 'sop', 'policy')),
	CONSTRAINT "knowledge_versions_title_valid" CHECK (length(trim("knowledge_article_versions"."title")) between 1 and 200),
	CONSTRAINT "knowledge_versions_summary_valid" CHECK ("knowledge_article_versions"."summary" is null or length("knowledge_article_versions"."summary") <= 1000),
	CONSTRAINT "knowledge_versions_tags_array" CHECK (jsonb_typeof("knowledge_article_versions"."tags") = 'array'),
	CONSTRAINT "knowledge_versions_sections_array" CHECK (jsonb_typeof("knowledge_article_versions"."sections") = 'array'),
	CONSTRAINT "knowledge_versions_audience_valid" CHECK ("knowledge_article_versions"."audience" in ('team', 'all_workspace_members')),
	CONSTRAINT "knowledge_versions_change_note_valid" CHECK ("knowledge_article_versions"."change_note" is null or length("knowledge_article_versions"."change_note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "knowledge_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"article_type" varchar(16) NOT NULL,
	"slug" varchar(160) NOT NULL,
	"draft_title" varchar(200) NOT NULL,
	"draft_summary" text,
	"draft_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"draft_sections" jsonb NOT NULL,
	"draft_audience" varchar(32) DEFAULT 'team' NOT NULL,
	"draft_acknowledgement_required" boolean DEFAULT false NOT NULL,
	"owner_user_id" uuid,
	"state" varchar(16) DEFAULT 'draft' NOT NULL,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"published_version" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_articles_type_valid" CHECK ("knowledge_articles"."article_type" in ('guide', 'sop', 'policy')),
	CONSTRAINT "knowledge_articles_slug_valid" CHECK ("knowledge_articles"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "knowledge_articles_title_valid" CHECK (length(trim("knowledge_articles"."draft_title")) between 1 and 200),
	CONSTRAINT "knowledge_articles_summary_valid" CHECK ("knowledge_articles"."draft_summary" is null or length("knowledge_articles"."draft_summary") <= 1000),
	CONSTRAINT "knowledge_articles_tags_array" CHECK (jsonb_typeof("knowledge_articles"."draft_tags") = 'array'),
	CONSTRAINT "knowledge_articles_sections_array" CHECK (jsonb_typeof("knowledge_articles"."draft_sections") = 'array'),
	CONSTRAINT "knowledge_articles_audience_valid" CHECK ("knowledge_articles"."draft_audience" in ('team', 'all_workspace_members')),
	CONSTRAINT "knowledge_articles_state_valid" CHECK ("knowledge_articles"."state" in ('draft', 'published', 'archived')),
	CONSTRAINT "knowledge_articles_draft_revision_positive" CHECK ("knowledge_articles"."draft_revision" > 0),
	CONSTRAINT "knowledge_articles_published_version_nonnegative" CHECK ("knowledge_articles"."published_version" >= 0),
	CONSTRAINT "knowledge_articles_publication_consistent" CHECK (("knowledge_articles"."published_version" = 0 and "knowledge_articles"."published_at" is null and "knowledge_articles"."state" = 'draft')
				or ("knowledge_articles"."published_version" > 0 and "knowledge_articles"."published_at" is not null and "knowledge_articles"."state" in ('published', 'archived'))),
	CONSTRAINT "knowledge_articles_archive_consistent" CHECK (("knowledge_articles"."state" = 'archived') = ("knowledge_articles"."archived_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "knowledge_command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"action" varchar(24) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_receipts_action_valid" CHECK ("knowledge_command_receipts"."action" in ('create', 'update', 'publish', 'archive', 'acknowledge')),
	CONSTRAINT "knowledge_receipts_hash_valid" CHECK ("knowledge_command_receipts"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "knowledge_receipts_response_object" CHECK (jsonb_typeof("knowledge_command_receipts"."response") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_articles_id_workspace_uq" ON "knowledge_articles" USING btree ("id","workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_versions_scope_version_uq" ON "knowledge_article_versions" USING btree ("article_id","workspace_id","version");
--> statement-breakpoint
ALTER TABLE "knowledge_acknowledgements" ADD CONSTRAINT "knowledge_acknowledgements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_acknowledgements" ADD CONSTRAINT "knowledge_acknowledgements_version_scope_fk" FOREIGN KEY ("article_id","workspace_id","article_version") REFERENCES "public"."knowledge_article_versions"("article_id","workspace_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_article_versions" ADD CONSTRAINT "knowledge_article_versions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_article_versions" ADD CONSTRAINT "knowledge_article_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_article_versions" ADD CONSTRAINT "knowledge_versions_article_scope_fk" FOREIGN KEY ("article_id","workspace_id") REFERENCES "public"."knowledge_articles"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_command_receipts" ADD CONSTRAINT "knowledge_command_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_command_receipts" ADD CONSTRAINT "knowledge_command_receipts_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_acknowledgements_article_version_user_uq" ON "knowledge_acknowledgements" USING btree ("article_id","article_version","user_id");--> statement-breakpoint
CREATE INDEX "knowledge_acknowledgements_user_idx" ON "knowledge_acknowledgements" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_versions_article_version_uq" ON "knowledge_article_versions" USING btree ("article_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_versions_article_draft_uq" ON "knowledge_article_versions" USING btree ("article_id","draft_revision");--> statement-breakpoint
CREATE INDEX "knowledge_versions_workspace_published_idx" ON "knowledge_article_versions" USING btree ("workspace_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_articles_workspace_slug_uq" ON "knowledge_articles" USING btree ("workspace_id",lower("slug"));--> statement-breakpoint
CREATE INDEX "knowledge_articles_workspace_state_idx" ON "knowledge_articles" USING btree ("workspace_id","state","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_receipts_actor_operation_uq" ON "knowledge_command_receipts" USING btree ("actor_user_id","operation_id");--> statement-breakpoint
CREATE INDEX "knowledge_receipts_workspace_idx" ON "knowledge_command_receipts" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE FUNCTION watson_validate_knowledge_payload(payload_tags jsonb, payload_sections jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
	item jsonb;
	tag_text text;
	seen_tags text[] := ARRAY[]::text[];
	total_body integer := 0;
BEGIN
	IF jsonb_typeof(payload_tags) <> 'array' OR jsonb_array_length(payload_tags) > 12 THEN
		RAISE EXCEPTION 'knowledge_tags_invalid' USING ERRCODE = '23514';
	END IF;
	FOR item IN SELECT value FROM jsonb_array_elements(payload_tags) LOOP
		IF jsonb_typeof(item) <> 'string' THEN
			RAISE EXCEPTION 'knowledge_tag_invalid' USING ERRCODE = '23514';
		END IF;
		tag_text := trim(both '"' from item::text);
		IF length(trim(tag_text)) NOT BETWEEN 1 AND 30 OR lower(tag_text) = ANY(seen_tags) THEN
			RAISE EXCEPTION 'knowledge_tag_invalid' USING ERRCODE = '23514';
		END IF;
		seen_tags := array_append(seen_tags, lower(tag_text));
	END LOOP;

	IF jsonb_typeof(payload_sections) <> 'array'
		OR jsonb_array_length(payload_sections) NOT BETWEEN 1 AND 50 THEN
		RAISE EXCEPTION 'knowledge_sections_invalid' USING ERRCODE = '23514';
	END IF;
	FOR item IN SELECT value FROM jsonb_array_elements(payload_sections) LOOP
		IF jsonb_typeof(item) <> 'object'
			OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3
			OR NOT (item ?& ARRAY['id', 'title', 'body'])
			OR jsonb_typeof(item->'id') <> 'string'
			OR jsonb_typeof(item->'title') <> 'string'
			OR jsonb_typeof(item->'body') <> 'string'
			OR (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
			OR length(trim(item->>'title')) NOT BETWEEN 1 AND 160
			OR length(item->>'body') NOT BETWEEN 1 AND 10000 THEN
			RAISE EXCEPTION 'knowledge_section_invalid' USING ERRCODE = '23514';
		END IF;
		total_body := total_body + length(item->>'body');
	END LOOP;
	IF total_body > 100000 THEN
		RAISE EXCEPTION 'knowledge_content_too_large' USING ERRCODE = '23514';
	END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION watson_validate_knowledge_article() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	PERFORM watson_validate_knowledge_payload(NEW.draft_tags, NEW.draft_sections);
	IF NEW.owner_user_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM workspaces w
		WHERE w.id = NEW.workspace_id AND (
			w.owner_id = NEW.owner_user_id OR EXISTS (
				SELECT 1 FROM memberships m
				WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.owner_user_id
			)
		)
	) THEN
		RAISE EXCEPTION 'knowledge_owner_not_member' USING ERRCODE = '23514';
	END IF;
	IF TG_OP = 'UPDATE' AND NEW.published_version < OLD.published_version THEN
		RAISE EXCEPTION 'knowledge_version_cannot_decrease' USING ERRCODE = '23514';
	END IF;
	IF NEW.published_version > 0 AND NOT EXISTS (
		SELECT 1 FROM knowledge_article_versions v
		WHERE v.article_id = NEW.id
			AND v.workspace_id = NEW.workspace_id
			AND v.version = NEW.published_version
	) THEN
		RAISE EXCEPTION 'knowledge_published_snapshot_missing' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_articles_validate_trg
BEFORE INSERT OR UPDATE ON knowledge_articles
FOR EACH ROW EXECUTE FUNCTION watson_validate_knowledge_article();
--> statement-breakpoint
CREATE FUNCTION watson_validate_knowledge_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	article_row knowledge_articles%ROWTYPE;
BEGIN
	IF TG_OP = 'UPDATE' THEN
		RAISE EXCEPTION 'knowledge_versions_are_immutable' USING ERRCODE = '55000';
	END IF;
	IF TG_OP = 'DELETE' THEN
		IF pg_trigger_depth() <= 1 THEN
			RAISE EXCEPTION 'knowledge_versions_are_immutable' USING ERRCODE = '55000';
		END IF;
		RETURN OLD;
	END IF;
	SELECT * INTO article_row FROM knowledge_articles
	WHERE id = NEW.article_id AND workspace_id = NEW.workspace_id
	FOR UPDATE;
	IF NOT FOUND OR NEW.version <> article_row.published_version + 1
		OR NEW.draft_revision <> article_row.draft_revision
		OR NEW.article_type <> article_row.article_type
		OR NEW.title <> article_row.draft_title
		OR NEW.summary IS DISTINCT FROM article_row.draft_summary
		OR NEW.tags <> article_row.draft_tags
		OR NEW.sections <> article_row.draft_sections
		OR NEW.audience <> article_row.draft_audience
		OR NEW.acknowledgement_required <> article_row.draft_acknowledgement_required
		OR NEW.owner_user_id IS DISTINCT FROM article_row.owner_user_id THEN
		RAISE EXCEPTION 'knowledge_snapshot_mismatch' USING ERRCODE = '23514';
	END IF;
	PERFORM watson_validate_knowledge_payload(NEW.tags, NEW.sections);
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_versions_validate_trg
BEFORE INSERT OR UPDATE OR DELETE ON knowledge_article_versions
FOR EACH ROW EXECUTE FUNCTION watson_validate_knowledge_version();
--> statement-breakpoint
CREATE FUNCTION watson_validate_knowledge_acknowledgement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	version_row knowledge_article_versions%ROWTYPE;
	article_row knowledge_articles%ROWTYPE;
	member_role text;
BEGIN
	SELECT * INTO version_row FROM knowledge_article_versions
	WHERE article_id = NEW.article_id
		AND workspace_id = NEW.workspace_id
		AND version = NEW.article_version;
	SELECT * INTO article_row FROM knowledge_articles
	WHERE id = NEW.article_id AND workspace_id = NEW.workspace_id;
	SELECT role::text INTO member_role FROM memberships
	WHERE workspace_id = NEW.workspace_id AND user_id = NEW.user_id;
	IF version_row.id IS NULL OR article_row.id IS NULL
		OR article_row.state <> 'published'
		OR article_row.published_version <> NEW.article_version
		OR NOT version_row.acknowledgement_required
		OR NOT (
			EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id AND w.owner_id = NEW.user_id)
			OR (member_role IS NOT NULL AND (member_role <> 'guest' OR version_row.audience = 'all_workspace_members'))
		) THEN
		RAISE EXCEPTION 'knowledge_acknowledgement_not_allowed' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_acknowledgements_validate_trg
BEFORE INSERT ON knowledge_acknowledgements
FOR EACH ROW EXECUTE FUNCTION watson_validate_knowledge_acknowledgement();
