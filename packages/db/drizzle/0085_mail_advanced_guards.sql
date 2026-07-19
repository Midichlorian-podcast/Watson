-- Cross-table tenant guards that cannot be expressed by Drizzle's single-column FKs.
CREATE OR REPLACE FUNCTION watson_guard_mail_saved_view()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM public.workspaces w
		WHERE w.id = NEW.workspace_id
		  AND w.owner_id = NEW.owner_user_id
		  AND w.is_personal = true
	) THEN
		RAISE EXCEPTION 'mail_saved_view_owner_mismatch' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mail_saved_views_owner_guard ON mail_saved_views;
CREATE TRIGGER mail_saved_views_owner_guard
BEFORE INSERT OR UPDATE OF workspace_id, owner_user_id ON mail_saved_views
FOR EACH ROW EXECUTE FUNCTION watson_guard_mail_saved_view();

CREATE OR REPLACE FUNCTION watson_guard_mail_followup()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM public.mail_outbound_messages o
		JOIN public.mail_accounts a ON a.id = o.account_id
		WHERE o.id = NEW.outbound_id
		  AND o.account_id = NEW.account_id
		  AND o.workspace_id = NEW.workspace_id
		  AND o.owner_user_id = NEW.owner_user_id
		  AND a.workspace_id = NEW.workspace_id
		  AND a.owner_user_id = NEW.owner_user_id
	) THEN
		RAISE EXCEPTION 'mail_followup_owner_mismatch' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mail_followups_owner_guard ON mail_followups;
CREATE TRIGGER mail_followups_owner_guard
BEFORE INSERT OR UPDATE OF workspace_id, account_id, owner_user_id, outbound_id ON mail_followups
FOR EACH ROW EXECUTE FUNCTION watson_guard_mail_followup();
