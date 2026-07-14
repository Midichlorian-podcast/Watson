ALTER TABLE "audit_events" ADD COLUMN "before" jsonb;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "request_id" varchar(16);