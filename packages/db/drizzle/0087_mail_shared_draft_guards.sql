CREATE OR REPLACE FUNCTION watson_guard_mail_shared_draft()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
	account_row public.mail_accounts%ROWTYPE;
BEGIN
	SELECT * INTO account_row FROM public.mail_accounts WHERE id = NEW.account_id;
	IF account_row.id IS NULL
	   OR account_row.owner_user_id <> NEW.owner_user_id
	   OR NEW.created_by_user_id <> NEW.owner_user_id
	   OR NOT EXISTS (
		SELECT 1 FROM public.workspaces w
		JOIN public.memberships m ON m.workspace_id = w.id AND m.user_id = NEW.owner_user_id
		WHERE w.id = NEW.workspace_id AND w.is_personal = false
	   ) THEN
		RAISE EXCEPTION 'mail_shared_draft_scope_mismatch' USING ERRCODE = '23514';
	END IF;
	IF TG_OP = 'UPDATE' THEN
		IF NEW.workspace_id <> OLD.workspace_id OR NEW.account_id <> OLD.account_id
		   OR NEW.owner_user_id <> OLD.owner_user_id OR NEW.created_by_user_id <> OLD.created_by_user_id
		   OR NEW.required_approvals <> OLD.required_approvals THEN
			RAISE EXCEPTION 'mail_shared_draft_source_immutable' USING ERRCODE = '23514';
		END IF;
		IF NOT (
			(OLD.status = 'draft' AND NEW.status IN ('draft', 'pending_approval', 'cancelled')) OR
			(OLD.status = 'pending_approval' AND NEW.status IN ('pending_approval', 'approved', 'rejected', 'cancelled')) OR
			(OLD.status = 'approved' AND NEW.status IN ('approved', 'queued', 'cancelled')) OR
			(OLD.status = 'rejected' AND NEW.status IN ('rejected', 'draft', 'cancelled')) OR
			(OLD.status = 'queued' AND NEW.status = 'queued') OR
			(OLD.status = 'cancelled' AND NEW.status = 'cancelled')
		) THEN
			RAISE EXCEPTION 'mail_shared_draft_transition_invalid' USING ERRCODE = '23514';
		END IF;
		IF (NEW.ciphertext, NEW.nonce, NEW.auth_tag, NEW.key_id, NEW.content_version)
		   IS DISTINCT FROM (OLD.ciphertext, OLD.nonce, OLD.auth_tag, OLD.key_id, OLD.content_version)
		   AND NEW.status <> 'draft' THEN
			RAISE EXCEPTION 'mail_shared_draft_content_locked' USING ERRCODE = '23514';
		END IF;
	END IF;
	IF NEW.status = 'pending_approval' AND (
		SELECT count(*) FROM public.mail_shared_draft_members dm
		WHERE dm.draft_id = NEW.id AND dm.role = 'approver'
	) < NEW.required_approvals THEN
		RAISE EXCEPTION 'mail_shared_draft_approvers_missing' USING ERRCODE = '23514';
	END IF;
	IF NEW.status = 'queued' AND NOT EXISTS (
		SELECT 1 FROM public.mail_outbound_messages o
		WHERE o.id = NEW.outbound_id AND o.account_id = NEW.account_id
		  AND o.owner_user_id = NEW.owner_user_id
	) THEN
		RAISE EXCEPTION 'mail_shared_draft_outbound_mismatch' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER mail_shared_drafts_scope_guard
BEFORE INSERT OR UPDATE ON mail_shared_drafts
FOR EACH ROW EXECUTE FUNCTION watson_guard_mail_shared_draft();

CREATE OR REPLACE FUNCTION watson_guard_mail_shared_draft_member()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
	draft_row public.mail_shared_drafts%ROWTYPE;
BEGIN
	SELECT * INTO draft_row FROM public.mail_shared_drafts WHERE id = NEW.draft_id;
	IF draft_row.id IS NULL OR NEW.user_id = draft_row.owner_user_id
	   OR NOT EXISTS (
		SELECT 1 FROM public.memberships m
		WHERE m.workspace_id = draft_row.workspace_id AND m.user_id = NEW.user_id
	   ) THEN
		RAISE EXCEPTION 'mail_shared_draft_member_scope_mismatch' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER mail_shared_draft_members_scope_guard
BEFORE INSERT OR UPDATE ON mail_shared_draft_members
FOR EACH ROW EXECUTE FUNCTION watson_guard_mail_shared_draft_member();

CREATE OR REPLACE FUNCTION watson_guard_mail_shared_draft_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM public.mail_shared_draft_members dm
		WHERE dm.draft_id = NEW.draft_id
		  AND dm.user_id = NEW.approver_user_id
		  AND dm.role = 'approver'
	) THEN
		RAISE EXCEPTION 'mail_shared_draft_approval_scope_mismatch' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER mail_shared_draft_approvals_scope_guard
BEFORE INSERT OR UPDATE OF draft_id, approver_user_id ON mail_shared_draft_approvals
FOR EACH ROW EXECUTE FUNCTION watson_guard_mail_shared_draft_approval();
