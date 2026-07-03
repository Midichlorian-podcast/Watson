ALTER TABLE "goals" ADD COLUMN "period" varchar(60);--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "filter_person_id" uuid;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "filter_keyword" varchar(120);--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_filter_person_id_users_id_fk" FOREIGN KEY ("filter_person_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;