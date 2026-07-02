ALTER TABLE "chain_steps" ADD COLUMN "anchor_offset" integer;--> statement-breakpoint
ALTER TABLE "chain_steps" ADD COLUMN "gap_days" integer;--> statement-breakpoint
ALTER TABLE "chains" ADD COLUMN "sched_mode" varchar(10) DEFAULT 'chain' NOT NULL;--> statement-breakpoint
ALTER TABLE "chains" ADD COLUMN "skip_weekend" integer DEFAULT 0 NOT NULL;