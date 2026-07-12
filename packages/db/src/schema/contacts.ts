/**
 * Kontakty — reálný adresář (dřív jen demo konstanty v mailu). Workspace-scoped
 * (sféra = workspaces.isPersonal): osobní prostor = soukromé kontakty, týmový =
 * sdílené. Zdroj pro našeptávání příjemce v mailu, budoucí správu kontaktů a
 * (přes `areas`) kontext pro AI směrování. Feedback 2026-07-12 „práce s kontakty
 * je slabá".
 */
import { index, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import { workspaces } from "./workspace";

export const contacts = pgTable(
	"contacts",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		name: varchar("name", { length: 200 }).notNull(),
		email: varchar("email", { length: 320 }),
		/** Organizace / firma. */
		org: varchar("org", { length: 200 }),
		/** Pozice / vztah (např. „grantová specialistka", „dodavatel tisku"). */
		role: varchar("role", { length: 200 }),
		/** Oblasti / expertíza (volný text nebo čárkami) — kontext pro AI směrování. */
		areas: text("areas"),
		note: text("note"),
		createdBy: uuid("created_by").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index("contacts_workspace_idx").on(t.workspaceId)],
);

export type Contact = typeof contacts.$inferSelect;
