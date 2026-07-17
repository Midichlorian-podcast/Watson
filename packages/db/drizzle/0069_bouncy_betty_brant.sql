CREATE TABLE "mail_command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"operation_id" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"action" varchar(24) NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_command_receipts_action_valid" CHECK ("mail_command_receipts"."action" in ('revoke')),
	CONSTRAINT "mail_command_receipts_request_hash_valid" CHECK ("mail_command_receipts"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mail_command_receipts_response_object" CHECK (jsonb_typeof("mail_command_receipts"."response") = 'object')
);
--> statement-breakpoint
CREATE TABLE "mail_oauth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"provider" varchar(24) DEFAULT 'google' NOT NULL,
	"state_hash" varchar(64) NOT NULL,
	"algorithm" varchar(24) DEFAULT 'aes-256-gcm-v1' NOT NULL,
	"key_id" varchar(64) NOT NULL,
	"nonce" varchar(24) NOT NULL,
	"auth_tag" varchar(32) NOT NULL,
	"ciphertext" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_oauth_sessions_provider_valid" CHECK ("mail_oauth_sessions"."provider" = 'google'),
	CONSTRAINT "mail_oauth_sessions_state_hash_valid" CHECK ("mail_oauth_sessions"."state_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mail_oauth_sessions_algorithm_valid" CHECK ("mail_oauth_sessions"."algorithm" = 'aes-256-gcm-v1'),
	CONSTRAINT "mail_oauth_sessions_key_id_valid" CHECK (length("mail_oauth_sessions"."key_id") between 1 and 64),
	CONSTRAINT "mail_oauth_sessions_nonce_valid" CHECK (length("mail_oauth_sessions"."nonce") between 16 and 24),
	CONSTRAINT "mail_oauth_sessions_tag_valid" CHECK (length("mail_oauth_sessions"."auth_tag") between 22 and 32),
	CONSTRAINT "mail_oauth_sessions_ciphertext_valid" CHECK (length("mail_oauth_sessions"."ciphertext") > 0),
	CONSTRAINT "mail_oauth_sessions_expiry_valid" CHECK ("mail_oauth_sessions"."expires_at" > "mail_oauth_sessions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "mail_command_receipts" ADD CONSTRAINT "mail_command_receipts_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_command_receipts" ADD CONSTRAINT "mail_command_receipts_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_oauth_sessions" ADD CONSTRAINT "mail_oauth_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_oauth_sessions" ADD CONSTRAINT "mail_oauth_sessions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_command_receipts_actor_operation_uq" ON "mail_command_receipts" USING btree ("actor_user_id","operation_id");--> statement-breakpoint
CREATE INDEX "mail_command_receipts_account_idx" ON "mail_command_receipts" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_oauth_sessions_state_hash_uq" ON "mail_oauth_sessions" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "mail_oauth_sessions_owner_created_idx" ON "mail_oauth_sessions" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "mail_oauth_sessions_expiry_idx" ON "mail_oauth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_mail_oauth_owner_scope()
RETURNS trigger AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM workspaces w
		WHERE w.id = NEW.workspace_id AND w.owner_id = NEW.owner_user_id
	) THEN
		RAISE EXCEPTION 'mail OAuth session must belong to its owner personal workspace'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER mail_oauth_sessions_owner_scope_guard
	BEFORE INSERT OR UPDATE OF workspace_id, owner_user_id ON mail_oauth_sessions
	FOR EACH ROW EXECUTE FUNCTION enforce_mail_oauth_owner_scope();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_mail_receipt_actor()
RETURNS trigger AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM mail_accounts ma
		WHERE ma.id = NEW.account_id AND ma.owner_user_id = NEW.actor_user_id
	) THEN
		RAISE EXCEPTION 'mail command receipt actor must own account'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER mail_command_receipts_actor_guard
	BEFORE INSERT OR UPDATE OF account_id, actor_user_id ON mail_command_receipts
	FOR EACH ROW EXECUTE FUNCTION enforce_mail_receipt_actor();
