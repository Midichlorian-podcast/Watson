-- P1-06 (§15/7): termín bez času je DATE — kalendářní den se nemění s pásmem.
-- Dry-run 2026-07-14: 51 due_date (15 s časem), 2 deadline (1 s časem);
-- u všech řádků Praha den == UTC den, převod je bezeztrátový. Europe/Prague
-- explicitně: hodnoty vznikaly v českém dni a půlnoc UTC = 01-02 h Praha (týž den).
ALTER TABLE "tasks" ALTER COLUMN "due_date" SET DATA TYPE date USING (due_date AT TIME ZONE 'Europe/Prague')::date;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "deadline" SET DATA TYPE date USING (deadline AT TIME ZONE 'Europe/Prague')::date;
