/**
 * Průřezové entity: filtry, palety, kalendář (per projekt — §12), audit (N6),
 * a AI vrstva (AISuggestion + AiPolicy per workspace dle AI_chovani_spec.md).
 */
import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import {
	actorTypeEnum,
	aiLevelEnum,
	aiSuggestionStatusEnum,
	calendarProviderEnum,
	ownerScopeEnum,
	recurrenceEditScopeEnum,
} from "./enums";
import { tasks } from "./task";
import { projects, workspaces } from "./workspace";

/** C5 — uložené filtry jako živé pohledy (dotazovací jazyk `&|!`). */
export const filters = pgTable("filters", {
	id: pk(),
	ownerScope: ownerScopeEnum("owner_scope").notNull().default("user"),
	/** Autor je povinný i u týmového pohledu; viditelnost určuje owner_scope. */
	userId: uuid("user_id")
		.references(() => users.id, { onDelete: "cascade" }),
	workspaceId: uuid("workspace_id")
		.references(() => workspaces.id, { onDelete: "cascade" }),
	name: varchar("name", { length: 160 }).notNull(),
	/** Legacy výraz zůstává kvůli exportům; nové pohledy používají tasks:v1 + config. */
	query: text("query").notNull(),
	surface: varchar("surface", { length: 32 }).notNull().default("tasks"),
	config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
	version: integer("version").notNull().default(1),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
}, (t) => [
	check("filters_surface_valid", sql`${t.surface} in ('tasks')`),
	check("filters_config_object", sql`jsonb_typeof(${t.config}) = 'object'`),
	check("filters_version_positive", sql`${t.version} > 0`),
	/** Legacy C5 řádky smějí zůstat; strukturovaný v1 pohled musí mít jednoznačný tenant i autora. */
	check(
		"filters_tasks_v1_owner",
		sql`${t.query} <> 'tasks:v1' OR (${t.workspaceId} IS NOT NULL AND ${t.userId} IS NOT NULL)`,
	),
	uniqueIndex("filters_personal_name_uq")
		.on(t.workspaceId, t.userId, t.surface, sql`lower(${t.name})`)
		.where(sql`${t.ownerScope} = 'user'`),
	uniqueIndex("filters_team_name_uq")
		.on(t.workspaceId, t.surface, sql`lower(${t.name})`)
		.where(sql`${t.ownerScope} = 'workspace'`),
	index("filters_workspace_scope_idx").on(t.workspaceId, t.ownerScope, t.surface),
]);

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

/**
 * F4 — serverový registr produkčních propojení. Neobsahuje tokeny ani provider
 * payloady; ty patří do odděleného vaultu/adaptéru. Klient čte pouze redigovaný
 * health snapshot přes API, tabulka se proto záměrně nesynchronizuje PowerSyncem.
 *
 * První adapter je osobní LuckyOS bridge. Workspace je osobní prostor vlastníka,
 * takže audit i lifecycle zůstávají tenant-scoped a případný budoucí týmový
 * provider může použít stejný model s jiným owner modelem.
 */
export const integrationConnections = pgTable(
	"integration_connections",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		ownerUserId: uuid("owner_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		provider: varchar("provider", { length: 64 }).notNull(),
		status: varchar("status", { length: 24 }).notNull().default("configured"),
		/** Stabilní machine-readable scopes/capabilities; nikdy credentials. */
		scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
		capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
		lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
		lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
		lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
		/** Pouze Watson allowlist kód; upstream text/URL/stack se neukládá. */
		lastErrorCode: varchar("last_error_code", { length: 64 }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		/** CAS verze mění pouze lifecycle commandy, ne průběžný health heartbeat. */
		version: integer("version").notNull().default(1),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		check("integration_connections_provider_valid", sql`${t.provider} in ('luckyos')`),
		check(
			"integration_connections_status_valid",
			sql`${t.status} in ('configured', 'healthy', 'degraded', 'not_configured', 'revoked')`,
		),
		check(
			"integration_connections_revoke_consistent",
			sql`(${t.status} = 'revoked') = (${t.revokedAt} IS NOT NULL)`,
		),
		check(
			"integration_connections_error_code_valid",
			sql`${t.lastErrorCode} IS NULL OR ${t.lastErrorCode} in ('luckyos_not_configured', 'luckyos_timeout', 'luckyos_unavailable', 'luckyos_identity_rejected', 'luckyos_identity_not_linked', 'luckyos_contract_rejected', 'luckyos_upstream_error')`,
		),
		check("integration_connections_scopes_array", sql`jsonb_typeof(${t.scopes}) = 'array'`),
		check(
			"integration_connections_capabilities_array",
			sql`jsonb_typeof(${t.capabilities}) = 'array'`,
		),
		check("integration_connections_version_positive", sql`${t.version} > 0`),
		uniqueIndex("integration_connections_owner_provider_uq").on(t.ownerUserId, t.provider),
		index("integration_connections_workspace_idx").on(t.workspaceId, t.provider),
	],
);

/**
 * Idempotency receipt pro revoke/reconnect. Payload hash brání použití stejného
 * operationId pro jinou lifecycle změnu; response dovolí bezpečný replay.
 */
export const integrationCommandReceipts = pgTable(
	"integration_command_receipts",
	{
		id: pk(),
		connectionId: uuid("connection_id")
			.notNull()
			.references(() => integrationConnections.id, { onDelete: "cascade" }),
		actorUserId: uuid("actor_user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		operationId: varchar("operation_id", { length: 128 }).notNull(),
		requestHash: varchar("request_hash", { length: 64 }).notNull(),
		action: varchar("action", { length: 24 }).notNull(),
		response: jsonb("response").$type<Record<string, unknown>>().notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		check("integration_command_receipts_action_valid", sql`${t.action} in ('revoke', 'reconnect')`),
		uniqueIndex("integration_command_receipts_actor_operation_uq").on(
			t.actorUserId,
			t.operationId,
		),
		index("integration_command_receipts_connection_idx").on(t.connectionId, t.createdAt),
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
		/** CC-P0-10: snapshot řádku PŘED mutací (PATCH/DELETE) — bez něj není delete vysvětlitelný ani obnovitelný. */
		before: jsonb("before"),
		/** CC-P0-10: korelace s API logem a klientským Centrem problémů (X-Request-Id). */
		requestId: varchar("request_id", { length: 16 }),
		createdAt: createdAt(),
	},
	(t) => [
		index("audit_workspace_idx").on(t.workspaceId),
		index("audit_entity_idx").on(t.entity, t.entityId),
	],
);

/**
 * Přijaté PowerSync operace. Zařízení + monotónní local op id tvoří
 * idempotency key; hash brání použití stejného klíče pro jiný payload.
 */
export const syncWriteReceipts = pgTable(
	"sync_write_receipts",
	{
		id: pk(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		clientId: varchar("client_id", { length: 128 }).notNull(),
		operationId: varchar("operation_id", { length: 32 }).notNull(),
		payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("sync_write_receipts_user_client_op_uq").on(
			t.userId,
			t.clientId,
			t.operationId,
		),
		index("sync_write_receipts_created_idx").on(t.createdAt),
	],
);

/**
 * Distribuovaný fixed-window rate limiter. Stav není procesová paměť: všechny API
 * instance sdílejí stejný atomický čítač a restart procesu limit nevynuluje.
 * `key` obsahuje pouze salted hash adresy, nikdy surové IP nebo uživatelský obsah.
 */
export const apiRateLimits = pgTable(
	"api_rate_limits",
	{
		key: varchar("key", { length: 160 }).primaryKey(),
		count: integer("count").notNull().default(0),
		windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(t) => [
		check("api_rate_limits_count_positive", sql`${t.count} > 0`),
		index("api_rate_limits_expires_idx").on(t.expiresAt),
	],
);

/**
 * Serverová kompenzace atomického smazání úkolového stromu. Snapshot zůstává 24 h
 * pouze na serveru; klient dostane neprůhledné ID. Tím delete+undo neštěpí jednu
 * business operaci do desítek samostatných PowerSync uploadů.
 */
export const taskUndoBatches = pgTable(
	"task_undo_batches",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		createdBy: uuid("created_by")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		operationId: varchar("operation_id", { length: 128 }).notNull(),
		requestHash: varchar("request_hash", { length: 64 }).notNull(),
		snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
		restoredAt: timestamp("restored_at", { withTimezone: true }),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("task_undo_batches_actor_operation_uq").on(t.createdBy, t.operationId),
		index("task_undo_batches_expiry_idx").on(t.expiresAt),
	],
);

/**
 * Krátkodobá, serverová kompenzace úpravy opakované řady. Náhled, provedení i undo
 * pracují nad verzovaným snapshotem; klient nikdy neskládá více neatomických zápisů.
 */
export const taskRecurrenceEditBatches = pgTable(
	"task_recurrence_edit_batches",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		taskId: uuid("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		occurrenceDate: varchar("occurrence_date", { length: 10 }).notNull(),
		scope: recurrenceEditScopeEnum("scope").notNull(),
		createdBy: uuid("created_by")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		operationId: varchar("operation_id", { length: 128 }).notNull(),
		requestHash: varchar("request_hash", { length: 64 }).notNull(),
		before: jsonb("before").$type<Record<string, unknown>>().notNull(),
		after: jsonb("after").$type<Record<string, unknown>>().notNull(),
		undoneAt: timestamp("undone_at", { withTimezone: true }),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		check(
			"task_recurrence_edit_batches_occurrence_date_format",
			sql`${t.occurrenceDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
		),
		uniqueIndex("task_recurrence_edit_batches_actor_operation_uq").on(
			t.createdBy,
			t.operationId,
		),
		index("task_recurrence_edit_batches_task_idx").on(t.taskId, t.occurrenceDate),
		index("task_recurrence_edit_batches_expiry_idx").on(t.expiresAt),
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

/**
 * Polymorfní vazby mezi entitami (mail↔úkol, LuckyOS↔úkol). Stejný vzor jako
 * `audit_events.(entity, entity_id)`. Dedup importu z cizích systémů přes
 * (source_system, external_id, to_type). Sdíleno mailovým i zaměstnaneckým modulem.
 * (Zaměstnanecký modul: files/ZAMESTNANEC_integracni_PLAN_2026-07-12.md §4.1.)
 */
export const entityLinks = pgTable(
	"entity_links",
	{
		id: pk(),
		/** Sféra / proklik (osobní sféra u zaměstnaneckých vazeb). */
		workspaceId: uuid("workspace_id").references(() => workspaces.id, {
			onDelete: "cascade",
		}),
		fromType: varchar("from_type", { length: 64 }).notNull(),
		fromId: varchar("from_id", { length: 128 }).notNull(),
		toType: varchar("to_type", { length: 64 }).notNull(),
		toId: varchar("to_id", { length: 128 }).notNull(),
		/** derived_from | references | belongs_to | mentions */
		relation: varchar("relation", { length: 32 })
			.notNull()
			.default("references"),
		/** 'luckyos' | 'mail' | null (interní vazba) */
		sourceSystem: varchar("source_system", { length: 32 }),
		/** = id v cizím systému (např. LuckyOS) pro dedup importu. */
		externalId: varchar("external_id", { length: 128 }),
		createdAt: createdAt(),
	},
	(t) => [
		index("entity_links_from_idx").on(t.fromType, t.fromId),
		index("entity_links_to_idx").on(t.toType, t.toId),
		uniqueIndex("entity_links_source_external_uq").on(
			t.workspaceId,
			t.sourceSystem,
			t.externalId,
			t.toType,
		),
	],
);

export type Filter = typeof filters.$inferSelect;
export type Palette = typeof palettes.$inferSelect;
export type CalendarConnection = typeof calendarConnections.$inferSelect;
export type CalendarLink = typeof calendarLinks.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type SyncWriteReceipt = typeof syncWriteReceipts.$inferSelect;
export type ApiRateLimit = typeof apiRateLimits.$inferSelect;
export type TaskUndoBatch = typeof taskUndoBatches.$inferSelect;
export type AiSuggestion = typeof aiSuggestions.$inferSelect;
export type AiPolicy = typeof aiPolicies.$inferSelect;
export type EntityLink = typeof entityLinks.$inferSelect;
