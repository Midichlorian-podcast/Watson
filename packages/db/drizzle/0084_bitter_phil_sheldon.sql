CREATE TABLE "mail_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"outbound_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" varchar(24) DEFAULT 'waiting' NOT NULL,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_followups_status_valid" CHECK ("mail_followups"."status" in ('waiting', 'replied', 'done', 'cancelled')),
	CONSTRAINT "mail_followups_completion_consistent" CHECK (("mail_followups"."status" in ('replied', 'done', 'cancelled')) = ("mail_followups"."completed_at" IS NOT NULL)),
	CONSTRAINT "mail_followups_version_positive" CHECK ("mail_followups"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "mail_provider_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"provider_label_id" varchar(256) NOT NULL,
	"name" varchar(256) NOT NULL,
	"kind" varchar(24) DEFAULT 'user' NOT NULL,
	"color" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_provider_labels_kind_valid" CHECK ("mail_provider_labels"."kind" in ('system', 'user', 'folder'))
);
--> statement-breakpoint
CREATE TABLE "mail_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"query" varchar(1000) NOT NULL,
	"sort" varchar(24) DEFAULT 'newest' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_saved_views_sort_valid" CHECK ("mail_saved_views"."sort" in ('newest', 'oldest', 'sender', 'subject')),
	CONSTRAINT "mail_saved_views_version_positive" CHECK ("mail_saved_views"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "mail_followups" ADD CONSTRAINT "mail_followups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_followups" ADD CONSTRAINT "mail_followups_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_followups" ADD CONSTRAINT "mail_followups_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_followups" ADD CONSTRAINT "mail_followups_outbound_id_mail_outbound_messages_id_fk" FOREIGN KEY ("outbound_id") REFERENCES "public"."mail_outbound_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_provider_labels" ADD CONSTRAINT "mail_provider_labels_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_saved_views" ADD CONSTRAINT "mail_saved_views_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_saved_views" ADD CONSTRAINT "mail_saved_views_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_followups_outbound_uq" ON "mail_followups" USING btree ("outbound_id");--> statement-breakpoint
CREATE INDEX "mail_followups_owner_due_idx" ON "mail_followups" USING btree ("owner_user_id","status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_provider_labels_account_provider_uq" ON "mail_provider_labels" USING btree ("account_id","provider_label_id");--> statement-breakpoint
CREATE INDEX "mail_provider_labels_account_name_idx" ON "mail_provider_labels" USING btree ("account_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_saved_views_owner_name_uq" ON "mail_saved_views" USING btree ("owner_user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "mail_saved_views_owner_idx" ON "mail_saved_views" USING btree ("owner_user_id","updated_at");