CREATE TABLE "mail_outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"operation_id" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"undo_until" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" varchar(128),
	"provider_thread_id" varchar(128),
	"accepted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"algorithm" varchar(24) DEFAULT 'aes-256-gcm-v1' NOT NULL,
	"key_id" varchar(64) NOT NULL,
	"nonce" varchar(24) NOT NULL,
	"auth_tag" varchar(32) NOT NULL,
	"ciphertext" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_outbound_status_valid" CHECK ("mail_outbound_messages"."status" in ('queued', 'sending', 'retry', 'accepted', 'cancelled', 'uncertain', 'failed')),
	CONSTRAINT "mail_outbound_request_hash_valid" CHECK ("mail_outbound_messages"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mail_outbound_schedule_valid" CHECK ("mail_outbound_messages"."undo_until" <= "mail_outbound_messages"."scheduled_for"),
	CONSTRAINT "mail_outbound_lease_consistent" CHECK (("mail_outbound_messages"."status" = 'sending') = ("mail_outbound_messages"."lease_token" IS NOT NULL AND "mail_outbound_messages"."lease_until" IS NOT NULL)),
	CONSTRAINT "mail_outbound_retry_consistent" CHECK (("mail_outbound_messages"."status" = 'retry') = ("mail_outbound_messages"."next_attempt_at" IS NOT NULL)),
	CONSTRAINT "mail_outbound_provider_refs_consistent" CHECK (("mail_outbound_messages"."provider_message_id" IS NULL) = ("mail_outbound_messages"."provider_thread_id" IS NULL)),
	CONSTRAINT "mail_outbound_accepted_consistent" CHECK (("mail_outbound_messages"."status" = 'accepted') = ("mail_outbound_messages"."accepted_at" IS NOT NULL AND "mail_outbound_messages"."provider_message_id" IS NOT NULL)),
	CONSTRAINT "mail_outbound_cancelled_consistent" CHECK (("mail_outbound_messages"."status" = 'cancelled') = ("mail_outbound_messages"."cancelled_at" IS NOT NULL)),
	CONSTRAINT "mail_outbound_error_valid" CHECK ("mail_outbound_messages"."last_error_code" IS NULL OR "mail_outbound_messages"."last_error_code" in ('mail_rate_limited', 'mail_auth_rejected', 'mail_provider_unavailable', 'mail_provider_timeout', 'mail_contract_rejected', 'mail_delivery_uncertain')),
	CONSTRAINT "mail_outbound_attempts_nonnegative" CHECK ("mail_outbound_messages"."attempts" >= 0),
	CONSTRAINT "mail_outbound_algorithm_valid" CHECK ("mail_outbound_messages"."algorithm" = 'aes-256-gcm-v1'),
	CONSTRAINT "mail_outbound_key_id_valid" CHECK (length("mail_outbound_messages"."key_id") between 1 and 64),
	CONSTRAINT "mail_outbound_nonce_valid" CHECK (length("mail_outbound_messages"."nonce") between 16 and 24),
	CONSTRAINT "mail_outbound_tag_valid" CHECK (length("mail_outbound_messages"."auth_tag") between 22 and 32),
	CONSTRAINT "mail_outbound_ciphertext_valid" CHECK (length("mail_outbound_messages"."ciphertext") > 0),
	CONSTRAINT "mail_outbound_content_version_positive" CHECK ("mail_outbound_messages"."content_version" > 0),
	CONSTRAINT "mail_outbound_version_positive" CHECK ("mail_outbound_messages"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "mail_command_receipts" DROP CONSTRAINT "mail_command_receipts_action_valid";--> statement-breakpoint
ALTER TABLE "mail_outbound_messages" ADD CONSTRAINT "mail_outbound_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_outbound_messages" ADD CONSTRAINT "mail_outbound_messages_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_outbound_messages" ADD CONSTRAINT "mail_outbound_messages_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_outbound_owner_operation_uq" ON "mail_outbound_messages" USING btree ("owner_user_id","operation_id");--> statement-breakpoint
CREATE INDEX "mail_outbound_claim_idx" ON "mail_outbound_messages" USING btree ("status","scheduled_for","next_attempt_at");--> statement-breakpoint
CREATE INDEX "mail_outbound_owner_account_idx" ON "mail_outbound_messages" USING btree ("owner_user_id","account_id","created_at");--> statement-breakpoint
ALTER TABLE "mail_command_receipts" ADD CONSTRAINT "mail_command_receipts_action_valid" CHECK ("mail_command_receipts"."action" in ('revoke', 'cancel_outbound'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_mail_outbound_scope_and_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	account_row record;
BEGIN
	IF TG_OP = 'INSERT' THEN
		SELECT a.workspace_id, a.owner_user_id, a.provider, a.status, w.owner_id, w.is_personal
		INTO account_row
		FROM mail_accounts a
		JOIN workspaces w ON w.id = a.workspace_id
		WHERE a.id = NEW.account_id;
		IF NOT FOUND OR account_row.workspace_id <> NEW.workspace_id
			OR account_row.owner_user_id <> NEW.owner_user_id
			OR account_row.owner_id <> NEW.owner_user_id
			OR account_row.is_personal IS DISTINCT FROM true
			OR account_row.provider <> 'google'
			OR account_row.status <> 'connected' THEN
			RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'mail_outbound_account_scope_mismatch';
		END IF;
		RETURN NEW;
	END IF;

	IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
		OR NEW.account_id IS DISTINCT FROM OLD.account_id
		OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
		OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
		OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
		OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
		OR NEW.undo_until IS DISTINCT FROM OLD.undo_until
		OR NEW.algorithm IS DISTINCT FROM OLD.algorithm
		OR NEW.key_id IS DISTINCT FROM OLD.key_id
		OR NEW.nonce IS DISTINCT FROM OLD.nonce
		OR NEW.auth_tag IS DISTINCT FROM OLD.auth_tag
		OR NEW.ciphertext IS DISTINCT FROM OLD.ciphertext
		OR NEW.content_version IS DISTINCT FROM OLD.content_version THEN
		RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'mail_outbound_source_immutable';
	END IF;
	IF NEW.version <> OLD.version + 1 OR NEW.attempts < OLD.attempts THEN
		RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'mail_outbound_version_invalid';
	END IF;
	IF NOT (
		(OLD.status = 'queued' AND NEW.status IN ('sending', 'cancelled')) OR
		(OLD.status = 'retry' AND NEW.status IN ('sending', 'cancelled')) OR
		(OLD.status = 'sending' AND NEW.status IN ('accepted', 'retry', 'uncertain', 'failed'))
	) THEN
		RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'mail_outbound_transition_invalid';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER mail_outbound_scope_lifecycle_guard
BEFORE INSERT OR UPDATE ON mail_outbound_messages
FOR EACH ROW EXECUTE FUNCTION enforce_mail_outbound_scope_and_lifecycle();
