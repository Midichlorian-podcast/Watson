/**
 * Průřezové entity: filtry, palety, kalendář (per projekt — §12), audit (N6),
 * a AI vrstva (AISuggestion + AiPolicy per workspace dle AI_chovani_spec.md).
 */
import {
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk } from "./_helpers";
import { users } from "./auth";
import {
	actorTypeEnum,
	aiLevelEnum,
	aiSuggestionStatusEnum,
	calendarProviderEnum,
	ownerScopeEnum,
} from "./enums";
import { tasks } from "./task";
import { projects, workspaces } from "./workspace";

/** C5 — uložené filtry jako živé pohledy (dotazovací jazyk `&|!`). */
export const filters = pgTable("filters", {
	id: pk(),
	ownerScope: ownerScopeEnum("owner_scope").notNull().default("user"),
	userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
	workspaceId: uuid("workspace_id").references(() => workspaces.id, {
		onDelete: "cascade",
	}),
	name: varchar("name", { length: 160 }).notNull(),
	query: text("query").notNull(),
	createdAt: createdAt(),
});

/** A8 — barevné palety (kurátorské + vlastní hex), oddělené od priority (R6). */
export const palettes = pgTable("palettes", {
	id: pk(),
	ownerScope: ownerScopeEnum("owner_scope").notNull().default("workspace"),
	userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
	workspaceId: uuid("workspace_id").references(() => workspaces.id, {
		onDelete: "cascade",
	}),
	name: varchar("name", { length: 160 }).notNull(),
	/** Pole hex barev. */
	colors: jsonb("colors").$type<string[]>().notNull().default([]),
	createdAt: createdAt(),
});

/**
 * D1/§12 — jeden sdílený Google kalendář na projekt (v týmovém Google účtu).
 * Tokeny jsou citlivé → v produkci šifrovat at-rest; secrets nikdy na klientu.
 */
export const calendarConnections = pgTable("calendar_connections", {
	id: pk(),
	projectId: uuid("project_id")
		.notNull()
		.references(() => projects.id, { onDelete: "cascade" }),
	provider: calendarProviderEnum("provider").notNull().default("google"),
	externalCalendarId: varchar("external_calendar_id", { length: 320 }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
	/** Inkrementální sync (watch + sync token). */
	syncToken: text("sync_token"),
	createdAt: createdAt(),
});

/** Mapovací tabulka úkol↔událost — brání duplicitám při obousměrném syncu. */
export const calendarLinks = pgTable(
	"calendar_links",
	{
		id: pk(),
		taskId: uuid("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		provider: calendarProviderEnum("provider").notNull().default("google"),
		externalEventId: varchar("external_event_id", { length: 320 }).notNull(),
		externalCalendarId: varchar("external_calendar_id", { length: 320 }),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("calendar_links_task_provider_uq").on(t.taskId, t.provider),
	],
);

/** N6 — audit s diffem; aktér může být `user` i `ai`. */
export const auditEvents = pgTable(
	"audit_events",
	{
		id: pk(),
		workspaceId: uuid("workspace_id").references(() => workspaces.id, {
			onDelete: "cascade",
		}),
		actorType: actorTypeEnum("actor_type").notNull().default("user"),
		actorUserId: uuid("actor_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		entity: varchar("entity", { length: 64 }).notNull(),
		entityId: uuid("entity_id"),
		action: varchar("action", { length: 64 }).notNull(),
		diff: jsonb("diff"),
		createdAt: createdAt(),
	},
	(t) => [
		index("audit_workspace_idx").on(t.workspaceId),
		index("audit_entity_idx").on(t.entity, t.entityId),
	],
);

/**
 * AISuggestion — fronta návrhů (suggest) i provedených auto_notify akcí.
 * Nic se neaplikuje tiše; vše projde sem (AI spec §1).
 */
export const aiSuggestions = pgTable("ai_suggestions", {
	id: pk(),
	workspaceId: uuid("workspace_id")
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	/** Schopnost/akce (např. "A2_breakdown", "G1_digest"). */
	type: varchar("type", { length: 64 }).notNull(),
	/** Odkaz na dotčenou entitu. */
	entity: varchar("entity", { length: 64 }),
	entityId: uuid("entity_id"),
	payload: jsonb("payload"),
	status: aiSuggestionStatusEnum("status").notNull().default("pending"),
	createdAt: createdAt(),
});

/**
 * AiPolicy — per workspace mapování schopnost → úroveň + uložené mantinely.
 * Editovatelné jen admin/manager (vynucuje app vrstva).
 */
export const aiPolicies = pgTable(
	"ai_policies",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		capability: varchar("capability", { length: 64 }).notNull(),
		level: aiLevelEnum("level").notNull().default("suggest"),
		/** Uložené mantinely / konfigurace (tiché hodiny, undo okno…). */
		config: jsonb("config"),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("ai_policies_workspace_capability_uq").on(
			t.workspaceId,
			t.capability,
		),
	],
);

export type Filter = typeof filters.$inferSelect;
export type Palette = typeof palettes.$inferSelect;
export type CalendarConnection = typeof calendarConnections.$inferSelect;
export type CalendarLink = typeof calendarLinks.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type AiSuggestion = typeof aiSuggestions.$inferSelect;
export type AiPolicy = typeof aiPolicies.$inferSelect;
