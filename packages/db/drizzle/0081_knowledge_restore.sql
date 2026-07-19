-- F7e: podepsaný serverový restore smí vložit finální článek před jeho historickými
-- snapshoty. Výjimka žije jen v transaction-local GUC nastaveném restore routou;
-- běžné příkazy dál procházejí plnou kontrolou pořadí a aktuální verze.
CREATE OR REPLACE FUNCTION watson_validate_knowledge_article() RETURNS trigger
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
	IF COALESCE(current_setting('watson.allow_knowledge_restore', true), 'off') <> 'on'
		AND NEW.published_version > 0 AND NOT EXISTS (
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
CREATE OR REPLACE FUNCTION watson_validate_knowledge_version() RETURNS trigger
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
	PERFORM watson_validate_knowledge_payload(NEW.tags, NEW.sections);
	IF COALESCE(current_setting('watson.allow_knowledge_restore', true), 'off') = 'on' THEN
		RETURN NEW;
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
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_validate_knowledge_acknowledgement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	version_row knowledge_article_versions%ROWTYPE;
	article_row knowledge_articles%ROWTYPE;
	member_role text;
BEGIN
	IF COALESCE(current_setting('watson.allow_knowledge_restore', true), 'off') = 'on' THEN
		RETURN NEW;
	END IF;
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
