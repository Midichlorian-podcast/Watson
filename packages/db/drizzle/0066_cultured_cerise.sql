ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_revoke_consistent" CHECK (("integration_connections"."status" = 'revoked') = ("integration_connections"."revoked_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_error_code_valid" CHECK ("integration_connections"."last_error_code" IS NULL OR "integration_connections"."last_error_code" in ('luckyos_not_configured', 'luckyos_timeout', 'luckyos_unavailable', 'luckyos_identity_rejected', 'luckyos_identity_not_linked', 'luckyos_contract_rejected', 'luckyos_upstream_error'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION integration_connection_personal_scope_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM workspaces w
		WHERE w.id = NEW.workspace_id
			AND w.owner_id = NEW.owner_user_id
			AND w.is_personal = true
	) THEN
		RAISE EXCEPTION 'integration connection must use its owner personal workspace'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER integration_connection_personal_scope_trg
BEFORE INSERT OR UPDATE OF workspace_id, owner_user_id ON integration_connections
FOR EACH ROW EXECUTE FUNCTION integration_connection_personal_scope_guard();--> statement-breakpoint
CREATE OR REPLACE FUNCTION integration_receipt_owner_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM integration_connections c
		WHERE c.id = NEW.connection_id
			AND c.owner_user_id = NEW.actor_user_id
	) THEN
		RAISE EXCEPTION 'integration receipt actor must own its connection'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER integration_receipt_owner_trg
BEFORE INSERT OR UPDATE OF connection_id, actor_user_id ON integration_command_receipts
FOR EACH ROW EXECUTE FUNCTION integration_receipt_owner_guard();
