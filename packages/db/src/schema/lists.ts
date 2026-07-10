/**
 * Seznamy — opakované checklisty na akce (MČR, show, nábory, soustředění).
 * Šablona → instance k akci: odškrtáváš, po akci „Reset po akci" (handoff 2026-07-10,
 * prototyp LIST_TEMPLATES ř. 2729–2748 + metody ř. 2749–2772). Workspace-scoped.
 */
import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import { projects, workspaces } from "./workspace";

export const lists = pgTable(
	"lists",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		/** Volitelná vazba na projekt (prototyp inst.proj). */
		projectId: uuid("project_id").references(() => projects.id, {
			onDelete: "set null",
		}),
		/** Z jaké šablony instance vznikla (volná reference — šablona smí zaniknout). */
		templateId: uuid("template_id"),
		name: varchar("name", { length: 300 }).notNull(),
		/** „datum a místo akce" — volný text (prototyp l.event, např. „pá 18. 7. · velký sál"). */
		event: varchar("event", { length: 200 }),
		archived: boolean("archived").notNull().default(false),
		createdBy: uuid("created_by").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index("lists_workspace_idx").on(t.workspaceId)],
);

export const listSections = pgTable(
	"list_sections",
	{
		id: pk(),
		listId: uuid("list_id")
			.notNull()
			.references(() => lists.id, { onDelete: "cascade" }),
		/** Denormalizace pro PowerSync scoping (workspace bucket). */
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		name: varchar("name", { length: 200 }).notNull(),
		position: integer("position").notNull().default(0),
		createdAt: createdAt(),
	},
	(t) => [index("list_sections_list_idx").on(t.listId)],
);

export const listItems = pgTable(
	"list_items",
	{
		id: pk(),
		listId: uuid("list_id")
			.notNull()
			.references(() => lists.id, { onDelete: "cascade" }),
		sectionId: uuid("section_id")
			.notNull()
			.references(() => listSections.id, { onDelete: "cascade" }),
		/** Denormalizace pro PowerSync scoping. */
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		text: varchar("text", { length: 500 }).notNull(),
		/** Množstevní štítek („12× kostým") — prototyp it.qty. */
		qty: varchar("qty", { length: 60 }),
		/** Kdo položku zajišťuje (avatar-assign) — lehčí než assignments (není to úkol). */
		whoId: uuid("who_id").references(() => users.id, { onDelete: "set null" }),
		done: boolean("done").notNull().default(false),
		position: integer("position").notNull().default(0),
		createdAt: createdAt(),
	},
	(t) => [
		index("list_items_list_idx").on(t.listId),
		index("list_items_section_idx").on(t.sectionId),
	],
);

export const listTemplates = pgTable(
	"list_templates",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		name: varchar("name", { length: 300 }).notNull(),
		description: varchar("description", { length: 300 }),
		/**
		 * Blueprint sekcí jako JSON text: [{ name, items: ["text" | "text|qty", …] }, …]
		 * (formát prototypu). Šablona je neživá předloha — netřeba řádkovat.
		 */
		sections: text("sections").notNull().default("[]"),
		createdBy: uuid("created_by").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index("list_templates_workspace_idx").on(t.workspaceId)],
);

export type List = typeof lists.$inferSelect;
export type ListSection = typeof listSections.$inferSelect;
export type ListItem = typeof listItems.$inferSelect;
export type ListTemplate = typeof listTemplates.$inferSelect;
