CREATE TABLE "mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"provider_message_id" varchar(128) NOT NULL,
	"provider_thread_id" varchar(128) NOT NULL,
	"history_id" varchar(64) NOT NULL,
	"internal_date" timestamp with time zone NOT NULL,
	"label_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"size_estimate" integer DEFAULT 0 NOT NULL,
	"algorithm" varchar(24) DEFAULT 'aes-256-gcm-v1' NOT NULL,
	"key_id" varchar(64) NOT NULL,
	"nonce" varchar(24) NOT NULL,
	"auth_tag" varchar(32) NOT NULL,
	"ciphertext" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"content_truncated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_messages_provider_message_id_valid" CHECK ("mail_messages"."provider_message_id" ~ '^[A-Za-z0-9_-]{1,128}$'),
	CONSTRAINT "mail_messages_provider_thread_id_valid" CHECK ("mail_messages"."provider_thread_id" ~ '^[A-Za-z0-9_-]{1,128}$'),
	CONSTRAINT "mail_messages_history_valid" CHECK ("mail_messages"."history_id" ~ '^[0-9]{1,64}$'),
	CONSTRAINT "mail_messages_labels_array" CHECK (jsonb_typeof("mail_messages"."label_ids") = 'array'),
	CONSTRAINT "mail_messages_size_nonnegative" CHECK ("mail_messages"."size_estimate" >= 0),
	CONSTRAINT "mail_messages_algorithm_valid" CHECK ("mail_messages"."algorithm" = 'aes-256-gcm-v1'),
	CONSTRAINT "mail_messages_key_id_valid" CHECK (length("mail_messages"."key_id") between 1 and 64),
	CONSTRAINT "mail_messages_nonce_valid" CHECK (length("mail_messages"."nonce") between 16 and 24),
	CONSTRAINT "mail_messages_tag_valid" CHECK (length("mail_messages"."auth_tag") between 22 and 32),
	CONSTRAINT "mail_messages_ciphertext_valid" CHECK (length("mail_messages"."ciphertext") > 0),
	CONSTRAINT "mail_messages_content_version_positive" CHECK ("mail_messages"."content_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "mail_sync_states" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"sync_mode" varchar(16) DEFAULT 'full' NOT NULL,
	"history_id" varchar(64),
	"baseline_history_id" varchar(64),
	"page_token" varchar(2048),
	"requested_at" timestamp with time zone DEFAULT now(),
	"next_attempt_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_sync_states_status_valid" CHECK ("mail_sync_states"."status" in ('pending', 'running', 'idle', 'retry', 'dead', 'reauth_required')),
	CONSTRAINT "mail_sync_states_mode_valid" CHECK ("mail_sync_states"."sync_mode" in ('full', 'partial')),
	CONSTRAINT "mail_sync_states_lease_consistent" CHECK (("mail_sync_states"."status" = 'running') = ("mail_sync_states"."lease_token" IS NOT NULL AND "mail_sync_states"."lease_until" IS NOT NULL)),
	CONSTRAINT "mail_sync_states_history_valid" CHECK ("mail_sync_states"."history_id" IS NULL OR "mail_sync_states"."history_id" ~ '^[0-9]{1,64}$'),
	CONSTRAINT "mail_sync_states_baseline_valid" CHECK ("mail_sync_states"."baseline_history_id" IS NULL OR "mail_sync_states"."baseline_history_id" ~ '^[0-9]{1,64}$'),
	CONSTRAINT "mail_sync_states_partial_cursor" CHECK ("mail_sync_states"."sync_mode" <> 'partial' OR "mail_sync_states"."history_id" IS NOT NULL),
	CONSTRAINT "mail_sync_states_attempts_nonnegative" CHECK ("mail_sync_states"."attempts" >= 0),
	CONSTRAINT "mail_sync_states_error_valid" CHECK ("mail_sync_states"."last_error_code" IS NULL OR "mail_sync_states"."last_error_code" in ('mail_provider_timeout', 'mail_provider_unavailable', 'mail_rate_limited', 'mail_auth_rejected', 'mail_contract_rejected', 'mail_history_expired')),
	CONSTRAINT "mail_sync_states_version_positive" CHECK ("mail_sync_states"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_sync_states" ADD CONSTRAINT "mail_sync_states_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_messages_account_provider_uq" ON "mail_messages" USING btree ("account_id","provider_message_id");--> statement-breakpoint
CREATE INDEX "mail_messages_account_date_idx" ON "mail_messages" USING btree ("account_id","internal_date");--> statement-breakpoint
CREATE INDEX "mail_messages_account_thread_idx" ON "mail_messages" USING btree ("account_id","provider_thread_id");--> statement-breakpoint
CREATE INDEX "mail_sync_states_claim_idx" ON "mail_sync_states" USING btree ("status","next_attempt_at","requested_at");--> statement-breakpoint
CREATE INDEX "mail_sync_states_lease_idx" ON "mail_sync_states" USING btree ("lease_until");