CREATE TABLE "task_undo_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"operation_id" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"restored_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_undo_batches" ADD CONSTRAINT "task_undo_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_undo_batches" ADD CONSTRAINT "task_undo_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_undo_batches_actor_operation_uq" ON "task_undo_batches" USING btree ("created_by","operation_id");--> statement-breakpoint
CREATE INDEX "task_undo_batches_expiry_idx" ON "task_undo_batches" USING btree ("expires_at");