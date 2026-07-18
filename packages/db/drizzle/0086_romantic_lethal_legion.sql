CREATE TABLE "mail_shared_draft_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"decided_content_version" integer,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_shared_draft_approvals_status_valid" CHECK ("mail_shared_draft_approvals"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "mail_shared_draft_approvals_decision_consistent" CHECK (("mail_shared_draft_approvals"."status" = 'pending') = ("mail_shared_draft_approvals"."decided_at" IS NULL AND "mail_shared_draft_approvals"."decided_content_version" IS NULL)),
	CONSTRAINT "mail_shared_draft_approvals_version_positive" CHECK ("mail_shared_draft_approvals"."decided_content_version" IS NULL OR "mail_shared_draft_approvals"."decided_content_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "mail_shared_draft_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_shared_draft_members_role_valid" CHECK ("mail_shared_draft_members"."role" in ('editor', 'approver'))
);
--> statement-breakpoint
CREATE TABLE "mail_shared_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"required_approvals" integer DEFAULT 1 NOT NULL,
	"algorithm" varchar(24) DEFAULT 'aes-256-gcm-v1' NOT NULL,
	"key_id" varchar(64) NOT NULL,
	"nonce" varchar(24) NOT NULL,
	"auth_tag" varchar(32) NOT NULL,
	"ciphertext" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"outbound_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_shared_drafts_status_valid" CHECK ("mail_shared_drafts"."status" in ('draft', 'pending_approval', 'approved', 'rejected', 'queued', 'cancelled')),
	CONSTRAINT "mail_shared_drafts_approval_count_valid" CHECK ("mail_shared_drafts"."required_approvals" between 1 and 20),
	CONSTRAINT "mail_shared_drafts_algorithm_valid" CHECK ("mail_shared_drafts"."algorithm" = 'aes-256-gcm-v1'),
	CONSTRAINT "mail_shared_drafts_key_id_valid" CHECK (length("mail_shared_drafts"."key_id") between 1 and 64),
	CONSTRAINT "mail_shared_drafts_nonce_valid" CHECK (length("mail_shared_drafts"."nonce") between 16 and 24),
	CONSTRAINT "mail_shared_drafts_tag_valid" CHECK (length("mail_shared_drafts"."auth_tag") between 22 and 32),
	CONSTRAINT "mail_shared_drafts_ciphertext_valid" CHECK (length("mail_shared_drafts"."ciphertext") > 0),
	CONSTRAINT "mail_shared_drafts_content_version_positive" CHECK ("mail_shared_drafts"."content_version" > 0),
	CONSTRAINT "mail_shared_drafts_version_positive" CHECK ("mail_shared_drafts"."version" > 0),
	CONSTRAINT "mail_shared_drafts_submitted_consistent" CHECK (("mail_shared_drafts"."status" in ('pending_approval', 'approved', 'rejected', 'queued')) = ("mail_shared_drafts"."submitted_at" IS NOT NULL)),
	CONSTRAINT "mail_shared_drafts_approved_consistent" CHECK (("mail_shared_drafts"."status" in ('approved', 'queued')) = ("mail_shared_drafts"."approved_at" IS NOT NULL)),
	CONSTRAINT "mail_shared_drafts_queued_consistent" CHECK (("mail_shared_drafts"."status" = 'queued') = ("mail_shared_drafts"."queued_at" IS NOT NULL AND "mail_shared_drafts"."outbound_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "mail_shared_draft_approvals" ADD CONSTRAINT "mail_shared_draft_approvals_draft_id_mail_shared_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."mail_shared_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_shared_draft_approvals" ADD CONSTRAINT "mail_shared_draft_approvals_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_shared_draft_members" ADD CONSTRAINT "mail_shared_draft_members_draft_id_mail_shared_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."mail_shared_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_shared_draft_members" ADD CONSTRAINT "mail_shared_draft_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_shared_drafts" ADD CONSTRAINT "mail_shared_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_shared_drafts" ADD CONSTRAINT "mail_shared_drafts_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_shared_drafts" ADD CONSTRAINT "mail_shared_drafts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_shared_drafts" ADD CONSTRAINT "mail_shared_drafts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_shared_drafts" ADD CONSTRAINT "mail_shared_drafts_outbound_id_mail_outbound_messages_id_fk" FOREIGN KEY ("outbound_id") REFERENCES "public"."mail_outbound_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_shared_draft_approvals_draft_user_uq" ON "mail_shared_draft_approvals" USING btree ("draft_id","approver_user_id");--> statement-breakpoint
CREATE INDEX "mail_shared_draft_approvals_user_status_idx" ON "mail_shared_draft_approvals" USING btree ("approver_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_shared_draft_members_draft_user_uq" ON "mail_shared_draft_members" USING btree ("draft_id","user_id");--> statement-breakpoint
CREATE INDEX "mail_shared_draft_members_user_idx" ON "mail_shared_draft_members" USING btree ("user_id","role");--> statement-breakpoint
CREATE INDEX "mail_shared_drafts_workspace_status_idx" ON "mail_shared_drafts" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "mail_shared_drafts_owner_idx" ON "mail_shared_drafts" USING btree ("owner_user_id","updated_at");