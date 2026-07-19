CREATE TABLE "attachment_blobs" (
	"attachment_id" uuid PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_blobs_size_valid" CHECK (octet_length("attachment_blobs"."data") > 0 and octet_length("attachment_blobs"."data") <= 20971520)
);
--> statement-breakpoint
CREATE TABLE "attachment_upload_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"desired_task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"finalized_attachment_id" uuid,
	"file_name" varchar(255) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"mime" varchar(160) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"data" "bytea",
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_upload_stages_size_valid" CHECK ("attachment_upload_stages"."size_bytes" > 0 and "attachment_upload_stages"."size_bytes" <= 20971520 and (
		("attachment_upload_stages"."finalized_attachment_id" is null and "attachment_upload_stages"."data" is not null and octet_length("attachment_upload_stages"."data") = "attachment_upload_stages"."size_bytes")
		or ("attachment_upload_stages"."finalized_attachment_id" is not null and "attachment_upload_stages"."data" is null)
	)),
	CONSTRAINT "attachment_upload_stages_sha256_valid" CHECK ("attachment_upload_stages"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_task_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "file_name" varchar(255);--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "sha256" varchar(64);--> statement-breakpoint
-- Dopředný backfill případných historických URL-only příloh. U komentáře odvodíme
-- vlastnící task, potom projekt. Neznámý hash je transparentní sentinel, ne tvrzení o obsahu.
UPDATE "attachments" a
SET "task_id" = c."task_id"
FROM "comments" c
WHERE a."task_id" IS NULL AND a."comment_id" = c."id";--> statement-breakpoint
UPDATE "attachments" a
SET "project_id" = t."project_id"
FROM "tasks" t
WHERE a."task_id" = t."id";--> statement-breakpoint
UPDATE "attachments"
SET "file_name" = left(COALESCE(NULLIF(regexp_replace("url", '^.*/', ''), ''), 'attachment'), 255),
    "sha256" = repeat('0', 64),
    "mime" = COALESCE("mime", 'application/octet-stream'),
    "size_bytes" = COALESCE("size_bytes", 1);--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "attachments"
		WHERE "task_id" IS NULL OR "project_id" IS NULL OR "file_name" IS NULL
	) THEN
		RAISE EXCEPTION 'attachment_backfill_failed';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "task_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "mime" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "size_bytes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "file_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "sha256" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachment_blobs" ADD CONSTRAINT "attachment_blobs_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_upload_stages" ADD CONSTRAINT "attachment_upload_stages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_upload_stages" ADD CONSTRAINT "attachment_upload_stages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_upload_stages_expiry_idx" ON "attachment_upload_stages" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "attachment_upload_stages_creator_idx" ON "attachment_upload_stages" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_task_same_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_comment_same_task_project_fk" FOREIGN KEY ("comment_id","task_id","project_id") REFERENCES "public"."comments"("id","task_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_task_idx" ON "attachments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "attachments_project_idx" ON "attachments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "attachments_comment_idx" ON "attachments" USING btree ("comment_id");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_size_valid" CHECK ("attachments"."size_bytes" > 0 and "attachments"."size_bytes" <= 20971520);--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_sha256_valid" CHECK ("attachments"."sha256" ~ '^[0-9a-f]{64}$');
