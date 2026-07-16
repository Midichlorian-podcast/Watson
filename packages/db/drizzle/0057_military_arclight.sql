CREATE TABLE "booking_page_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"duration_min" integer NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"organizer_id" uuid NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_pages_title_valid" CHECK (char_length(trim("booking_pages"."title")) between 1 and 200),
	CONSTRAINT "booking_pages_description_valid" CHECK ("booking_pages"."description" is null or char_length("booking_pages"."description") <= 2000),
	CONSTRAINT "booking_pages_duration_valid" CHECK ("booking_pages"."duration_min" between 5 and 1440),
	CONSTRAINT "booking_pages_timezone_shape" CHECK ("booking_pages"."timezone" ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+)$'),
	CONSTRAINT "booking_pages_version_valid" CHECK ("booking_pages"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "booking_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"booked_by" uuid NOT NULL,
	"meeting_id" uuid,
	"hub_task_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_reservations_version_valid" CHECK ("booking_reservations"."version" > 0),
	CONSTRAINT "booking_reservations_meeting_pair_valid" CHECK (("booking_reservations"."meeting_id" is null) = ("booking_reservations"."hub_task_id" is null))
);
--> statement-breakpoint
CREATE TABLE "booking_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_slots_time_valid" CHECK ("booking_slots"."ends_at" > "booking_slots"."starts_at"),
	CONSTRAINT "booking_slots_version_valid" CHECK ("booking_slots"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "meetings" DROP CONSTRAINT "meetings_status_valid";--> statement-breakpoint
CREATE UNIQUE INDEX "projects_id_workspace_uq" ON "projects" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_pages_id_project_uq" ON "booking_pages" USING btree ("id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_pages_id_workspace_uq" ON "booking_pages" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_slots_id_page_uq" ON "booking_slots" USING btree ("id","page_id");--> statement-breakpoint
ALTER TABLE "booking_page_participants" ADD CONSTRAINT "booking_page_participants_page_project_fk" FOREIGN KEY ("page_id","project_id") REFERENCES "public"."booking_pages"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_page_participants" ADD CONSTRAINT "booking_page_participants_project_member_fk" FOREIGN KEY ("project_id","user_id") REFERENCES "public"."project_members"("project_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_project_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_organizer_project_member_fk" FOREIGN KEY ("project_id","organizer_id") REFERENCES "public"."project_members"("project_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reservations" ADD CONSTRAINT "booking_reservations_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reservations" ADD CONSTRAINT "booking_reservations_hub_task_id_tasks_id_fk" FOREIGN KEY ("hub_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reservations" ADD CONSTRAINT "booking_reservations_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reservations" ADD CONSTRAINT "booking_reservations_page_project_fk" FOREIGN KEY ("page_id","project_id") REFERENCES "public"."booking_pages"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reservations" ADD CONSTRAINT "booking_reservations_slot_page_fk" FOREIGN KEY ("slot_id","page_id") REFERENCES "public"."booking_slots"("id","page_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reservations" ADD CONSTRAINT "booking_reservations_booker_project_member_fk" FOREIGN KEY ("project_id","booked_by") REFERENCES "public"."project_members"("project_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_slots" ADD CONSTRAINT "booking_slots_page_id_booking_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."booking_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_page_participants_page_user_uq" ON "booking_page_participants" USING btree ("page_id","user_id");--> statement-breakpoint
CREATE INDEX "booking_page_participants_user_idx" ON "booking_page_participants" USING btree ("user_id","page_id");--> statement-breakpoint
CREATE INDEX "booking_pages_workspace_idx" ON "booking_pages" USING btree ("workspace_id","archived_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_reservations_active_slot_uq" ON "booking_reservations" USING btree ("slot_id") WHERE "booking_reservations"."cancelled_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_reservations_meeting_uq" ON "booking_reservations" USING btree ("meeting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_reservations_hub_uq" ON "booking_reservations" USING btree ("hub_task_id");--> statement-breakpoint
CREATE INDEX "booking_reservations_booker_idx" ON "booking_reservations" USING btree ("booked_by","cancelled_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_slots_page_start_uq" ON "booking_slots" USING btree ("page_id","starts_at") WHERE "booking_slots"."cancelled_at" is null;--> statement-breakpoint
CREATE INDEX "booking_slots_page_time_idx" ON "booking_slots" USING btree ("page_id","starts_at");--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_status_valid" CHECK ("meetings"."status" in ('new', 'scheduled', 'transcribed', 'extracted', 'committed', 'cancelled'));
