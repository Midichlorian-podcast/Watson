CREATE TABLE "mail_task_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"source_message_id" uuid NOT NULL,
	"provider_message_id" varchar(128) NOT NULL,
	"source_task_id" uuid NOT NULL,
	"source_project_id" uuid NOT NULL,
	"operation_id" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"retired_at" timestamp with time zone,
	"retired_reason" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_task_links_provider_message_id_valid" CHECK ("mail_task_links"."provider_message_id" ~ '^[A-Za-z0-9_-]{1,128}$'),
	CONSTRAINT "mail_task_links_request_hash_valid" CHECK ("mail_task_links"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mail_task_links_retired_consistent" CHECK (("mail_task_links"."retired_at" IS NULL) = ("mail_task_links"."retired_reason" IS NULL)),
	CONSTRAINT "mail_task_links_retired_reason_valid" CHECK ("mail_task_links"."retired_reason" IS NULL OR "mail_task_links"."retired_reason" in ('task_missing', 'replaced'))
);
--> statement-breakpoint
ALTER TABLE "mail_task_links" ADD CONSTRAINT "mail_task_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_task_links" ADD CONSTRAINT "mail_task_links_account_id_mail_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_task_links" ADD CONSTRAINT "mail_task_links_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_task_links_owner_operation_uq" ON "mail_task_links" USING btree ("owner_user_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_task_links_active_message_uq" ON "mail_task_links" USING btree ("account_id","provider_message_id") WHERE "mail_task_links"."retired_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_task_links_source_task_uq" ON "mail_task_links" USING btree ("source_task_id");--> statement-breakpoint
CREATE INDEX "mail_task_links_owner_account_idx" ON "mail_task_links" USING btree ("owner_user_id","account_id","created_at");--> statement-breakpoint
CREATE INDEX "mail_task_links_workspace_idx" ON "mail_task_links" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_mail_task_link_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	account_row record;
	message_row record;
	task_row record;
BEGIN
	IF TG_OP = 'UPDATE' AND (
		NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
		NEW.account_id IS DISTINCT FROM OLD.account_id OR
		NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR
		NEW.source_message_id IS DISTINCT FROM OLD.source_message_id OR
		NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id OR
		NEW.source_task_id IS DISTINCT FROM OLD.source_task_id OR
		NEW.source_project_id IS DISTINCT FROM OLD.source_project_id OR
		NEW.operation_id IS DISTINCT FROM OLD.operation_id OR
		NEW.request_hash IS DISTINCT FROM OLD.request_hash
	) THEN
		RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'mail_task_link_source_immutable';
	END IF;
	IF TG_OP = 'UPDATE' THEN
		RETURN NEW;
	END IF;

	SELECT a.workspace_id, a.owner_user_id, w.owner_id, w.is_personal
	INTO account_row
	FROM mail_accounts a
	JOIN workspaces w ON w.id = a.workspace_id
	WHERE a.id = NEW.account_id;
	IF NOT FOUND OR account_row.workspace_id <> NEW.workspace_id
		OR account_row.owner_user_id <> NEW.owner_user_id
		OR account_row.owner_id <> NEW.owner_user_id
		OR account_row.is_personal IS DISTINCT FROM true THEN
		RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'mail_task_link_account_scope_mismatch';
	END IF;

	SELECT m.account_id, m.provider_message_id
	INTO message_row
	FROM mail_messages m
	WHERE m.id = NEW.source_message_id;
	IF NOT FOUND OR message_row.account_id <> NEW.account_id
		OR message_row.provider_message_id <> NEW.provider_message_id THEN
		RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'mail_task_link_message_scope_mismatch';
	END IF;

	SELECT t.project_id, p.workspace_id
	INTO task_row
	FROM tasks t
	JOIN projects p ON p.id = t.project_id
	WHERE t.id = NEW.source_task_id;
	IF NOT FOUND OR task_row.project_id <> NEW.source_project_id
		OR task_row.workspace_id <> NEW.workspace_id THEN
		RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'mail_task_link_task_scope_mismatch';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER mail_task_links_scope_guard
BEFORE INSERT OR UPDATE ON mail_task_links
FOR EACH ROW EXECUTE FUNCTION enforce_mail_task_link_scope();
