CREATE TABLE "comment_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"marked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_decisions" ADD CONSTRAINT "comment_decisions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_decisions" ADD CONSTRAINT "comment_decisions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_decisions" ADD CONSTRAINT "comment_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_decisions" ADD CONSTRAINT "comment_decisions_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_decisions_comment_uq" ON "comment_decisions" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "comment_decisions_task_idx" ON "comment_decisions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "comment_decisions_project_idx" ON "comment_decisions" USING btree ("project_id");
