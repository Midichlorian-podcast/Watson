CREATE TABLE "sync_write_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" varchar(128) NOT NULL,
	"operation_id" varchar(32) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_write_receipts" ADD CONSTRAINT "sync_write_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_write_receipts_user_client_op_uq" ON "sync_write_receipts" USING btree ("user_id","client_id","operation_id");--> statement-breakpoint
CREATE INDEX "sync_write_receipts_created_idx" ON "sync_write_receipts" USING btree ("created_at");