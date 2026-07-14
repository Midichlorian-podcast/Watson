CREATE TABLE "entity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"from_type" varchar(64) NOT NULL,
	"from_id" varchar(128) NOT NULL,
	"to_type" varchar(64) NOT NULL,
	"to_id" varchar(128) NOT NULL,
	"relation" varchar(32) DEFAULT 'references' NOT NULL,
	"source_system" varchar(32),
	"external_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_links_from_idx" ON "entity_links" USING btree ("from_type","from_id");--> statement-breakpoint
CREATE INDEX "entity_links_to_idx" ON "entity_links" USING btree ("to_type","to_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_links_source_external_uq" ON "entity_links" USING btree ("source_system","external_id","to_type");