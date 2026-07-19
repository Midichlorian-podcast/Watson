ALTER TABLE "mail_messages" DROP CONSTRAINT "mail_messages_history_valid";--> statement-breakpoint
ALTER TABLE "mail_sync_states" DROP CONSTRAINT "mail_sync_states_history_valid";--> statement-breakpoint
ALTER TABLE "mail_sync_states" DROP CONSTRAINT "mail_sync_states_baseline_valid";--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_history_valid" CHECK ("mail_messages"."history_id" ~ '^(?:[0-9]{1,64}|[0-9]{1,32}:[0-9]{1,20})$');--> statement-breakpoint
ALTER TABLE "mail_sync_states" ADD CONSTRAINT "mail_sync_states_history_valid" CHECK ("mail_sync_states"."history_id" IS NULL OR "mail_sync_states"."history_id" ~ '^(?:[0-9]{1,64}|[0-9]{1,32}:[0-9]{1,20})$');--> statement-breakpoint
ALTER TABLE "mail_sync_states" ADD CONSTRAINT "mail_sync_states_baseline_valid" CHECK ("mail_sync_states"."baseline_history_id" IS NULL OR "mail_sync_states"."baseline_history_id" ~ '^(?:[0-9]{1,64}|[0-9]{1,32}:[0-9]{1,20})$');