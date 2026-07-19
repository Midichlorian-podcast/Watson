DROP INDEX "reminders_pending_idx";--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "delivery_state" varchar(16) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "last_error_code" varchar(64);--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "provider_message_id" varchar(256);--> statement-breakpoint
CREATE INDEX "reminders_pending_idx" ON "reminders" USING btree ("delivery_state","next_attempt_at","remind_at") WHERE delivery_state in ('pending', 'retry', 'claimed');--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_delivery_state_valid" CHECK ("reminders"."delivery_state" in ('pending', 'claimed', 'retry', 'sent', 'dead'));--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_attempts_nonnegative" CHECK ("reminders"."attempts" >= 0);