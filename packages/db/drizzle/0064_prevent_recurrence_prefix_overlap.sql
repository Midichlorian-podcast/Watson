CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "task_recurrence_prefixes"
	ADD CONSTRAINT "task_recurrence_prefixes_no_overlap"
	EXCLUDE USING gist (
		"task_id" WITH =,
		daterange("anchor_date", "end_date", '[]') WITH &&
	);
