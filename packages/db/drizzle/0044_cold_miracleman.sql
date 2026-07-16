CREATE TABLE "comment_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" varchar(8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reactions_emoji_valid" CHECK ("comment_reactions"."emoji" in ('👍', '❤️', '🎉', '👀'))
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "comments_id_task_project_uq" ON "comments" USING btree ("id","task_id","project_id");--> statement-breakpoint
ALTER TABLE "mentions" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "mentions" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "mentions" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "mentions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "mentions" m
SET "task_id" = c."task_id", "project_id" = c."project_id"
FROM "comments" c
WHERE c."id" = m."comment_id";--> statement-breakpoint
ALTER TABLE "mentions" ALTER COLUMN "task_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mentions" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_same_task_project_fk" FOREIGN KEY ("comment_id","task_id","project_id") REFERENCES "public"."comments"("id","task_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_task_same_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reactions_user_emoji_uq" ON "comment_reactions" USING btree ("comment_id","user_id","emoji");--> statement-breakpoint
CREATE INDEX "comment_reactions_comment_idx" ON "comment_reactions" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "comment_reactions_task_idx" ON "comment_reactions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "comment_reactions_project_idx" ON "comment_reactions" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_same_task_project_fk" FOREIGN KEY ("parent_id","task_id","project_id") REFERENCES "public"."comments"("id","task_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_comment_same_task_project_fk" FOREIGN KEY ("comment_id","task_id","project_id") REFERENCES "public"."comments"("id","task_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_task_same_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_parent_idx" ON "comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "mentions_user_idx" ON "mentions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mentions_task_idx" ON "mentions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "mentions_project_idx" ON "mentions" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_not_self_parent" CHECK ("comments"."parent_id" is null or "comments"."parent_id" <> "comments"."id");
