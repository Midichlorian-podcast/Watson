CREATE TABLE "mail_account_credentials" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"secret_kind" varchar(24) NOT NULL,
	"algorithm" varchar(24) DEFAULT 'aes-256-gcm-v1' NOT NULL,
	"key_id" varchar(64) NOT NULL,
	"nonce" varchar(24) NOT NULL,
	"auth_tag" varchar(32) NOT NULL,
	"ciphertext" text NOT NULL,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_account_credentials_kind_valid" CHECK ("mail_account_credentials"."secret_kind" in ('google_oauth', 'imap_smtp')),
	CONSTRAINT "mail_account_credentials_algorithm_valid" CHECK ("mail_account_credentials"."algorithm" = 'aes-256-gcm-v1'),
	CONSTRAINT "mail_account_credentials_key_id_valid" CHECK (length("mail_account_credentials"."key_id") between 1 and 64),
	CONSTRAINT "mail_account_credentials_nonce_valid" CHECK (length("mail_account_credentials"."nonce") between 16 and 24),
	CONSTRAINT "mail_account_credentials_tag_valid" CHECK (length("mail_account_credentials"."auth_tag") between 22 and 32),
	CONSTRAINT "mail_account_credentials_ciphertext_valid" CHECK (length("mail_account_credentials"."ciphertext") > 0),
	CONSTRAINT "mail_account_credentials_version_positive" CHECK ("mail_account_credentials"."credential_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "mail_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"provider" varchar(24) NOT NULL,
	"email_address" varchar(320) NOT NULL,
	"display_name" varchar(160),
	"provider_account_hash" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'connected' NOT NULL,
	"granted_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"revoked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_accounts_provider_valid" CHECK ("mail_accounts"."provider" in ('google', 'imap_smtp')),
	CONSTRAINT "mail_accounts_status_valid" CHECK ("mail_accounts"."status" in ('connected', 'syncing', 'degraded', 'reauth_required', 'revoked')),
	CONSTRAINT "mail_accounts_revoke_consistent" CHECK (("mail_accounts"."status" = 'revoked') = ("mail_accounts"."revoked_at" IS NOT NULL)),
	CONSTRAINT "mail_accounts_provider_hash_valid" CHECK ("mail_accounts"."provider_account_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mail_accounts_error_code_valid" CHECK ("mail_accounts"."last_error_code" IS NULL OR "mail_accounts"."last_error_code" in ('mail_auth_revoked', 'mail_token_expired', 'mail_provider_unavailable', 'mail_sync_cursor_invalid', 'mail_credentials_invalid', 'mail_scope_missing', 'mail_contract_rejected', 'mail_rate_limited')),
	CONSTRAINT "mail_accounts_scopes_array" CHECK (jsonb_typeof("mail_accounts"."granted_scopes") = 'array'),
	CONSTRAINT "mail_accounts_capabilities_array" CHECK (jsonb_typeof("mail_accounts"."capabilities") = 'array'),
	CONSTRAINT "mail_accounts_version_positive" CHECK ("mail_accounts"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "mail_account_credentials" ADD CONSTRAINT "mail_account_credentials_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_accounts_owner_provider_identity_uq" ON "mail_accounts" USING btree ("owner_user_id","provider","provider_account_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_accounts_owner_address_uq" ON "mail_accounts" USING btree ("owner_user_id","provider",lower("email_address"));--> statement-breakpoint
CREATE INDEX "mail_accounts_workspace_owner_idx" ON "mail_accounts" USING btree ("workspace_id","owner_user_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_mail_account_owner_scope()
RETURNS trigger AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM workspaces w
		WHERE w.id = NEW.workspace_id AND w.owner_id = NEW.owner_user_id
	) THEN
		RAISE EXCEPTION 'mail account must belong to its owner personal workspace'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER mail_accounts_owner_scope_guard
	BEFORE INSERT OR UPDATE OF workspace_id, owner_user_id ON mail_accounts
	FOR EACH ROW EXECUTE FUNCTION enforce_mail_account_owner_scope();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_mail_credential_provider()
RETURNS trigger AS $$
DECLARE
	account_provider text;
BEGIN
	SELECT provider INTO account_provider FROM mail_accounts WHERE id = NEW.account_id;
	IF account_provider IS NULL OR
		(account_provider = 'google' AND NEW.secret_kind <> 'google_oauth') OR
		(account_provider = 'imap_smtp' AND NEW.secret_kind <> 'imap_smtp') THEN
		RAISE EXCEPTION 'mail credential kind does not match account provider'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER mail_account_credentials_provider_guard
	BEFORE INSERT OR UPDATE OF account_id, secret_kind ON mail_account_credentials
	FOR EACH ROW EXECUTE FUNCTION enforce_mail_credential_provider();
