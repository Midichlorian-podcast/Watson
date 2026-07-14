-- CC-P0-15: same-project invarianty v DB (parent a sekce úkolu musí patřit do
-- stejného projektu). Unique indexy MUSÍ vzniknout před FK, které na ně míří
-- (generátor je vypsal obráceně). Pre-migration report 2026-07-14: 0 porušení.
CREATE UNIQUE INDEX "tasks_id_project_uq" ON "tasks" USING btree ("id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_id_project_uq" ON "sections" USING btree ("id","project_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_same_project_fk" FOREIGN KEY ("parent_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_section_same_project_fk" FOREIGN KEY ("section_id","project_id") REFERENCES "public"."sections"("id","project_id") ON DELETE no action ON UPDATE no action;