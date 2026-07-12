/**
 * Mítingy — vstupní brána „přepis schůzky → úkoly". Uživatel vloží text z porady,
 * AI (Claude) z něj vytáhne úkoly (název, návrh řešitele dle `memberships.areas`,
 * priorita, termín, projekt, hierarchie) a uloží je jako NÁVRH do `extraction`
 * (jsonb). Člověk návrh doplní/upraví a teprve pak vzniknou reálné úkoly přes
 * write-path (human-in-the-loop). Workspace-scoped (sféra = workspaces.isPersonal).
 * Feedback 2026-07-12: „modul Mítingy — přepis → AI úkoly, přiřazení, priority".
 */
import { index, jsonb, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import { workspaces } from "./workspace";

export const meetings = pgTable(
	"meetings",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		/** Název mítingu (uživatel nebo odvozený AI). */
		title: varchar("title", { length: 300 }),
		/** Přepis / poznámky z porady — surový vstup pro extrakci. */
		transcript: text("transcript"),
		/**
		 * Stav zpracování: 'new' (jen přepis) → 'extracted' (AI navrhla úkoly) →
		 * 'committed' (úkoly potvrzeny a založeny). Řídí UI v modulu Mítingy.
		 */
		status: varchar("status", { length: 20 }).notNull().default("new"),
		/**
		 * NÁVRH úkolů od AI (jsonb) — pole položek { title, note?, assigneeHint?,
		 * assigneeUserId?, priority?, due?, projectHint?, parentIndex? }. Kanonický
		 * zdroj pro review; po commitu se z něj založí reálné úkoly. Zapisuje server
		 * (extract endpoint), čte klient přes PowerSync.
		 */
		extraction: jsonb("extraction"),
		createdBy: uuid("created_by").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index("meetings_workspace_idx").on(t.workspaceId)],
);

export type Meeting = typeof meetings.$inferSelect;
