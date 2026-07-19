ALTER TABLE "tasks" ADD COLUMN "why_now" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_why_now_length"
CHECK ("why_now" IS NULL OR char_length("why_now") <= 1000);
