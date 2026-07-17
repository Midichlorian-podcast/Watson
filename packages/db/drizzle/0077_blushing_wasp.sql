CREATE TABLE "luckyos_event_inbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"event_type" varchar(160) NOT NULL,
	"aggregate_type" varchar(160) NOT NULL,
	"aggregate_id" varchar(255) NOT NULL,
	"aggregate_version" integer NOT NULL,
	"provider_person_id" varchar(255),
	"owner_user_id" uuid,
	"correlation_id" varchar(128) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"disposition" varchar(64) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "luckyos_event_inbox_version_positive" CHECK ("luckyos_event_inbox"."aggregate_version" > 0),
	CONSTRAINT "luckyos_event_inbox_status_valid" CHECK ("luckyos_event_inbox"."status" in ('pending', 'processed', 'ignored', 'failed')),
	CONSTRAINT "luckyos_event_inbox_payload_bounded" CHECK (octet_length("luckyos_event_inbox"."payload"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "luckyos_identity_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"provider_person_id" varchar(255) NOT NULL,
	"status" varchar(24) NOT NULL,
	"provider_version" integer NOT NULL,
	"last_event_id" uuid NOT NULL,
	"last_event_at" timestamp with time zone NOT NULL,
	"reason_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "luckyos_identity_bindings_status_valid" CHECK ("luckyos_identity_bindings"."status" in ('pending', 'active', 'suspended', 'revoked')),
	CONSTRAINT "luckyos_identity_bindings_version_positive" CHECK ("luckyos_identity_bindings"."provider_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "luckyos_event_inbox" ADD CONSTRAINT "luckyos_event_inbox_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "luckyos_identity_bindings" ADD CONSTRAINT "luckyos_identity_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "luckyos_identity_bindings" ADD CONSTRAINT "luckyos_identity_bindings_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "luckyos_event_inbox_idempotency_uq" ON "luckyos_event_inbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "luckyos_event_inbox_pending_idx" ON "luckyos_event_inbox" USING btree ("created_at") WHERE "luckyos_event_inbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "luckyos_event_inbox_owner_idx" ON "luckyos_event_inbox" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "luckyos_identity_bindings_owner_uq" ON "luckyos_identity_bindings" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "luckyos_identity_bindings_provider_person_uq" ON "luckyos_identity_bindings" USING btree ("organization_id","provider_person_id");--> statement-breakpoint
CREATE INDEX "luckyos_identity_bindings_workspace_idx" ON "luckyos_identity_bindings" USING btree ("workspace_id","status");