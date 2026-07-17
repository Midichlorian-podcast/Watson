CREATE TABLE "integration_command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"operation_id" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"action" varchar(24) NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_command_receipts_action_valid" CHECK ("integration_command_receipts"."action" in ('revoke', 'reconnect'))
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"provider" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'configured' NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"revoked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_provider_valid" CHECK ("integration_connections"."provider" in ('luckyos')),
	CONSTRAINT "integration_connections_status_valid" CHECK ("integration_connections"."status" in ('configured', 'healthy', 'degraded', 'not_configured', 'revoked')),
	CONSTRAINT "integration_connections_scopes_array" CHECK (jsonb_typeof("integration_connections"."scopes") = 'array'),
	CONSTRAINT "integration_connections_capabilities_array" CHECK (jsonb_typeof("integration_connections"."capabilities") = 'array'),
	CONSTRAINT "integration_connections_version_positive" CHECK ("integration_connections"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "integration_command_receipts" ADD CONSTRAINT "integration_command_receipts_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_command_receipts" ADD CONSTRAINT "integration_command_receipts_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_command_receipts_actor_operation_uq" ON "integration_command_receipts" USING btree ("actor_user_id","operation_id");--> statement-breakpoint
CREATE INDEX "integration_command_receipts_connection_idx" ON "integration_command_receipts" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_owner_provider_uq" ON "integration_connections" USING btree ("owner_user_id","provider");--> statement-breakpoint
CREATE INDEX "integration_connections_workspace_idx" ON "integration_connections" USING btree ("workspace_id","provider");