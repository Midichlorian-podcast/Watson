CREATE TABLE "api_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"scopes" varchar(32)[] NOT NULL,
	"project_ids" uuid[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_clients_name_nonempty" CHECK (char_length(btrim("api_clients"."name")) > 0),
	CONSTRAINT "api_clients_key_prefix_format" CHECK ("api_clients"."key_prefix" ~ '^[A-Za-z0-9_-]{8,16}$'),
	CONSTRAINT "api_clients_key_hash_format" CHECK ("api_clients"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "api_clients_scopes_nonempty" CHECK (cardinality("api_clients"."scopes") between 1 and 3),
	CONSTRAINT "api_clients_projects_nonempty" CHECK (cardinality("api_clients"."project_ids") between 1 and 100),
	CONSTRAINT "api_clients_scopes_valid" CHECK ("api_clients"."scopes" <@ ARRAY['projects:read','tasks:read','tasks:write']::varchar[]),
	CONSTRAINT "api_clients_expiry_future" CHECK ("api_clients"."expires_at" is null or "api_clients"."expires_at" > "api_clients"."created_at")
);
--> statement-breakpoint
CREATE TABLE "api_command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"status_code" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_command_receipts_hash_format" CHECK ("api_command_receipts"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "api_command_receipts_status_valid" CHECK ("api_command_receipts"."status_code" between 200 and 299)
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"response_status" integer,
	"last_error_code" varchar(64),
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_status_valid" CHECK ("webhook_deliveries"."status" in ('pending','delivered','dead')),
	CONSTRAINT "webhook_deliveries_attempts_valid" CHECK ("webhook_deliveries"."attempt_count" between 0 and 8),
	CONSTRAINT "webhook_deliveries_response_status_valid" CHECK ("webhook_deliveries"."response_status" is null or "webhook_deliveries"."response_status" between 100 and 599)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"event_type" varchar(48) NOT NULL,
	"entity_type" varchar(24) NOT NULL,
	"entity_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fanout_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_entity_valid" CHECK ("webhook_events"."entity_type" in ('task','project')),
	CONSTRAINT "webhook_events_type_valid" CHECK ("webhook_events"."event_type" in ('task.created','task.updated','task.completed','task.deleted','project.created','project.updated','project.deleted')),
	CONSTRAINT "webhook_events_payload_object" CHECK (jsonb_typeof("webhook_events"."payload") = 'object')
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"endpoint_url" varchar(2048) NOT NULL,
	"event_types" varchar(48)[] NOT NULL,
	"project_ids" uuid[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_subscriptions_name_nonempty" CHECK (char_length(btrim("webhook_subscriptions"."name")) > 0),
	CONSTRAINT "webhook_subscriptions_events_nonempty" CHECK (cardinality("webhook_subscriptions"."event_types") between 1 and 7),
	CONSTRAINT "webhook_subscriptions_projects_nonempty" CHECK (cardinality("webhook_subscriptions"."project_ids") between 1 and 100),
	CONSTRAINT "webhook_subscriptions_events_valid" CHECK ("webhook_subscriptions"."event_types" <@ ARRAY['task.created','task.updated','task.completed','task.deleted','project.created','project.updated','project.deleted']::varchar[]),
	CONSTRAINT "webhook_subscriptions_version_positive" CHECK ("webhook_subscriptions"."version" > 0),
	CONSTRAINT "webhook_subscriptions_failure_count_valid" CHECK ("webhook_subscriptions"."failure_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_command_receipts" ADD CONSTRAINT "api_command_receipts_client_id_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."api_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_webhook_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."webhook_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_clients_key_prefix_uq" ON "api_clients" USING btree ("key_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "api_clients_key_hash_uq" ON "api_clients" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_clients_workspace_idx" ON "api_clients" USING btree ("workspace_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_command_receipts_client_key_uq" ON "api_command_receipts" USING btree ("client_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "api_command_receipts_created_idx" ON "api_command_receipts" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_subscription_event_uq" ON "webhook_deliveries" USING btree ("subscription_id","event_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_pending_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_events_fanout_idx" ON "webhook_events" USING btree ("fanout_at","occurred_at");--> statement-breakpoint
CREATE INDEX "webhook_events_workspace_idx" ON "webhook_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "webhook_subscriptions_workspace_idx" ON "webhook_subscriptions" USING btree ("workspace_id","active");
--> statement-breakpoint
/**
 * Transactional webhook outbox. A trigger is intentionally below every write
 * path (PowerSync, bulk commands, automations and the public API). Recovery
 * transactions can suppress it with the transaction-local Watson GUC.
 */
CREATE OR REPLACE FUNCTION watson_task_webhook_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	row_data tasks%ROWTYPE;
	workspace_uuid uuid;
	kind text;
BEGIN
	IF COALESCE(current_setting('watson.suppress_webhook_events', true), 'off') = 'on' THEN
		RETURN COALESCE(NEW, OLD);
	END IF;
	-- Project/workspace cascades have their own event and must not fan out one
	-- deletion per child task. A direct task delete enters at depth one.
	IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
		RETURN OLD;
	END IF;
	row_data := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
	SELECT p.workspace_id INTO workspace_uuid FROM projects p WHERE p.id = row_data.project_id;
	IF workspace_uuid IS NULL THEN
		RETURN COALESCE(NEW, OLD);
	END IF;
	kind := CASE
		WHEN TG_OP = 'INSERT' THEN 'task.created'
		WHEN TG_OP = 'DELETE' THEN 'task.deleted'
		WHEN OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL THEN 'task.completed'
		ELSE 'task.updated'
	END;
	INSERT INTO webhook_events (
		workspace_id, event_type, entity_type, entity_id, project_id, payload, occurred_at
	) VALUES (
		workspace_uuid,
		kind,
		'task',
		row_data.id,
		row_data.project_id,
		jsonb_strip_nulls(jsonb_build_object(
			'id', row_data.id,
			'project_id', row_data.project_id,
			'name', row_data.name,
			'priority', row_data.priority,
			'due_date', row_data.due_date,
			'deadline', row_data.deadline,
			'start_at', row_data.start_date,
			'duration_min', row_data.duration_min,
			'completed_at', row_data.completed_at,
			'updated_at', row_data.updated_at
		)),
		now()
	);
	RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION watson_project_webhook_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	row_data projects%ROWTYPE;
	kind text;
BEGIN
	IF COALESCE(current_setting('watson.suppress_webhook_events', true), 'off') = 'on' THEN
		RETURN COALESCE(NEW, OLD);
	END IF;
	-- Workspace deletion is a terminal tenant operation; no endpoint remains to
	-- receive the event and the workspace FK is being removed in the same tx.
	IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
		RETURN OLD;
	END IF;
	row_data := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
	-- FK cascade order is implementation-dependent: in a workspace cascade this
	-- trigger can still report depth one after the parent row disappeared.
	IF TG_OP = 'DELETE' AND NOT EXISTS (
		SELECT 1 FROM workspaces w WHERE w.id = row_data.workspace_id
	) THEN
		RETURN OLD;
	END IF;
	kind := CASE
		WHEN TG_OP = 'INSERT' THEN 'project.created'
		WHEN TG_OP = 'DELETE' THEN 'project.deleted'
		ELSE 'project.updated'
	END;
	INSERT INTO webhook_events (
		workspace_id, event_type, entity_type, entity_id, project_id, payload, occurred_at
	) VALUES (
		row_data.workspace_id,
		kind,
		'project',
		row_data.id,
		row_data.id,
		jsonb_strip_nulls(jsonb_build_object(
			'id', row_data.id,
			'workspace_id', row_data.workspace_id,
			'name', row_data.name,
			'kind', row_data.kind,
			'status', row_data.status,
			'delivery_date', row_data.delivery_date,
			'updated_at', row_data.updated_at
		)),
		now()
	);
	RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE TRIGGER watson_tasks_webhook_outbox
AFTER INSERT OR UPDATE OR DELETE ON tasks
FOR EACH ROW EXECUTE FUNCTION watson_task_webhook_outbox();
--> statement-breakpoint
CREATE TRIGGER watson_projects_webhook_outbox
AFTER INSERT OR UPDATE OR DELETE ON projects
FOR EACH ROW EXECUTE FUNCTION watson_project_webhook_outbox();
