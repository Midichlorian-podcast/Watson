ALTER TABLE "reminders" DROP CONSTRAINT "reminders_delivery_state_valid";--> statement-breakpoint
DROP INDEX "reminders_pending_idx";--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "held_reason" varchar(32);--> statement-breakpoint
CREATE INDEX "reminders_pending_idx" ON "reminders" USING btree ("delivery_state","next_attempt_at","remind_at") WHERE delivery_state in ('pending', 'retry', 'claimed', 'held');--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_held_shape" CHECK (("reminders"."delivery_state" = 'held') = ("reminders"."held_at" is not null and "reminders"."held_reason" is not null));--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_delivery_state_valid" CHECK ("reminders"."delivery_state" in ('pending', 'claimed', 'held', 'retry', 'sent', 'dead'));