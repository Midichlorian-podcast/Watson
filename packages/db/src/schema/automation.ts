/**
 * F6 — Rules & Automation Engine.
 *
 * `automation_rules.draft_config` je jediný měnitelný návrh. Publikace vždy vytvoří
 * neměnný `automation_rule_versions` snapshot a každý běh se připne právě k němu.
 * Tím pozdější editace draftu nikdy nezmění již spuštěný ani historický běh.
 */
import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
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
import { projects, workspaces } from "./workspace";

export type AutomationTrigger =
	| { type: "task_created" }
	| { type: "task_completed" }
	| { type: "task_reopened" };

export type AutomationCondition =
	| { field: "priority"; operator: "equals"; value: number }
	| { field: "deadline"; operator: "is_set"; value: boolean }
	| { field: "assignee"; operator: "is_set"; value: boolean };

export type AutomationAction =
	| { type: "set_priority"; value: number }
	| { type: "set_due_offset"; days: number; overwrite: boolean }
	| { type: "add_comment"; body: string };

export type AutomationConfig = {
	timezone: string;
	trigger: AutomationTrigger;
	conditions: AutomationCondition[];
	actions: AutomationAction[];
};

export const automationRules = pgTable(
	"automation_rules",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		name: varchar("name", { length: 200 }).notNull(),
		description: text("description"),
		state: varchar("state", { length: 16 }).notNull().default("enabled"),
		draftRevision: integer("draft_revision").notNull().default(1),
		draftConfig: jsonb("draft_config").$type<AutomationConfig>().notNull(),
		createdBy: uuid("created_by")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		createOperationId: varchar("create_operation_id", { length: 128 }).notNull(),
		createRequestHash: varchar("create_request_hash", { length: 64 }).notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		check("automation_rules_name_valid", sql`length(trim(${t.name})) between 1 and 200`),
		check("automation_rules_state_valid", sql`${t.state} in ('enabled', 'paused', 'archived')`),
		check("automation_rules_draft_revision_positive", sql`${t.draftRevision} > 0`),
		check("automation_rules_draft_config_object", sql`jsonb_typeof(${t.draftConfig}) = 'object'`),
		foreignKey({
			name: "automation_rules_project_workspace_fk",
			columns: [t.projectId, t.workspaceId],
			foreignColumns: [projects.id, projects.workspaceId],
		}).onDelete("cascade"),
		uniqueIndex("automation_rules_actor_operation_uq").on(t.createdBy, t.createOperationId),
		uniqueIndex("automation_rules_id_scope_uq").on(t.id, t.workspaceId, t.projectId),
		index("automation_rules_project_idx").on(t.projectId, t.state),
	],
);

export const automationRuleVersions = pgTable(
	"automation_rule_versions",
	{
		id: pk(),
		ruleId: uuid("rule_id").notNull(),
		workspaceId: uuid("workspace_id").notNull(),
		projectId: uuid("project_id").notNull(),
		version: integer("version").notNull(),
		/** Přesná revize draftu, ze které snapshot vznikl; jednu revizi lze publikovat jen jednou. */
		draftRevision: integer("draft_revision").notNull(),
		config: jsonb("config").$type<AutomationConfig>().notNull(),
		publishedBy: uuid("published_by")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		publishOperationId: varchar("publish_operation_id", { length: 128 }).notNull(),
		publishRequestHash: varchar("publish_request_hash", { length: 64 }).notNull(),
		publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		check("automation_rule_versions_version_positive", sql`${t.version} > 0`),
		check("automation_rule_versions_draft_revision_positive", sql`${t.draftRevision} > 0`),
		check("automation_rule_versions_config_object", sql`jsonb_typeof(${t.config}) = 'object'`),
		foreignKey({
			name: "automation_rule_versions_rule_scope_fk",
			columns: [t.ruleId, t.workspaceId, t.projectId],
			foreignColumns: [automationRules.id, automationRules.workspaceId, automationRules.projectId],
		}).onDelete("cascade"),
		uniqueIndex("automation_rule_versions_rule_version_uq").on(t.ruleId, t.version),
		uniqueIndex("automation_rule_versions_rule_draft_revision_uq").on(
			t.ruleId,
			t.draftRevision,
		),
		uniqueIndex("automation_rule_versions_actor_operation_uq").on(
			t.publishedBy,
			t.publishOperationId,
		),
		uniqueIndex("automation_rule_versions_id_scope_uq").on(
			t.id,
			t.ruleId,
			t.workspaceId,
			t.projectId,
		),
		index("automation_rule_versions_rule_idx").on(t.ruleId, t.publishedAt),
	],
);

export type AutomationRunSnapshot = {
	taskId: string;
	changes: Array<{
		type: "set_priority" | "set_due_offset" | "add_comment";
		entityId: string;
		before: unknown;
		after: unknown;
	}>;
};

export const automationRuns = pgTable(
	"automation_runs",
	{
		id: pk(),
		ruleId: uuid("rule_id").notNull(),
		ruleVersionId: uuid("rule_version_id").notNull(),
		workspaceId: uuid("workspace_id").notNull(),
		projectId: uuid("project_id").notNull(),
		/** Soft reference: audit retention nesmí smazat procesní historii běhu. */
		eventId: uuid("event_id").notNull(),
		/** Soft reference: smazání úkolu nesmí odstranit procesní analytiku. */
		taskId: uuid("task_id").notNull(),
		status: varchar("status", { length: 16 }).notNull().default("queued"),
		triggerType: varchar("trigger_type", { length: 32 }).notNull(),
		result: jsonb("result").$type<AutomationRunSnapshot>(),
		errorCode: varchar("error_code", { length: 64 }),
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		undoExpiresAt: timestamp("undo_expires_at", { withTimezone: true }),
		undoneAt: timestamp("undone_at", { withTimezone: true }),
		createdAt: createdAt(),
	},
	(t) => [
		check(
			"automation_runs_status_valid",
			sql`${t.status} in ('queued', 'running', 'succeeded', 'skipped', 'failed', 'undone')`,
		),
		check(
			"automation_runs_trigger_valid",
			sql`${t.triggerType} in ('task_created', 'task_completed', 'task_reopened')`,
		),
		foreignKey({
			name: "automation_runs_rule_scope_fk",
			columns: [t.ruleId, t.workspaceId, t.projectId],
			foreignColumns: [automationRules.id, automationRules.workspaceId, automationRules.projectId],
		}).onDelete("cascade"),
		foreignKey({
			name: "automation_runs_version_scope_fk",
			columns: [t.ruleVersionId, t.ruleId, t.workspaceId, t.projectId],
			foreignColumns: [
				automationRuleVersions.id,
				automationRuleVersions.ruleId,
				automationRuleVersions.workspaceId,
				automationRuleVersions.projectId,
			],
		}).onDelete("cascade"),
		uniqueIndex("automation_runs_version_event_uq").on(t.ruleVersionId, t.eventId),
		index("automation_runs_status_idx").on(t.status, t.createdAt),
		index("automation_runs_rule_idx").on(t.ruleId, t.createdAt),
	],
);

export type AutomationRule = typeof automationRules.$inferSelect;
export type AutomationRuleVersion = typeof automationRuleVersions.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
