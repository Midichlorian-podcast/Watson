/**
 * Jednorázový řízený import z CSV/exportů jiných aplikací.
 * Preview zůstává stateless; až potvrzené provedení ukládá minimální stopu nutnou
 * pro idempotenci, audit a bezpečný rollback bez archivace celého zdrojového souboru.
 */
import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import { attachments } from "./collab";
import { tasks } from "./task";
import { projects, workspaces } from "./workspace";

export const importBatches = pgTable(
	"import_batches",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
		source: varchar("source", { length: 24 }).notNull(),
		sourceName: varchar("source_name", { length: 255 }).notNull(),
		/** SHA-256 zdrojového souboru vypočtený v prohlížeči. */
		sourceFingerprint: varchar("source_fingerprint", { length: 64 }).notNull(),
		/** SHA-256 kanonického normalizovaného commandu pro přesný retry. */
		requestHash: varchar("request_hash", { length: 64 }).notNull(),
		status: varchar("status", { length: 16 }).notNull().default("imported"),
		itemCount: integer("item_count").notNull(),
		attachmentExpected: integer("attachment_expected").notNull().default(0),
		/** ID sekcí/štítků vytvořených výhradně importem; rollback je smaže jen pokud zůstaly nepoužité. */
		createdSectionIds: jsonb("created_section_ids").$type<string[]>().notNull().default([]),
		createdLabelIds: jsonb("created_label_ids").$type<string[]>().notNull().default([]),
		importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
		rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		uniqueIndex("import_batches_id_project_uq").on(t.id, t.projectId),
		uniqueIndex("import_batches_source_active_uq")
			.on(t.projectId, t.sourceFingerprint)
			.where(sql`${t.rolledBackAt} is null`),
		index("import_batches_workspace_idx").on(t.workspaceId),
		index("import_batches_project_idx").on(t.projectId),
		check("import_batches_source_valid", sql`${t.source} in ('csv', 'asana', 'trello', 'todoist')`),
		check("import_batches_status_valid", sql`${t.status} in ('imported', 'rolled_back')`),
		check(
			"import_batches_status_shape",
			sql`(${t.status} = 'imported' and ${t.rolledBackAt} is null) or (${t.status} = 'rolled_back' and ${t.rolledBackAt} is not null)`,
		),
		check("import_batches_item_count_valid", sql`${t.itemCount} between 1 and 2000`),
		check(
			"import_batches_attachment_count_valid",
			sql`${t.attachmentExpected} between 0 and 100000`,
		),
		check(
			"import_batches_fingerprint_valid",
			sql`${t.sourceFingerprint} ~ '^[0-9a-f]{64}$' and ${t.requestHash} ~ '^[0-9a-f]{64}$'`,
		),
		check(
			"import_batches_created_ids_shape",
			sql`jsonb_typeof(${t.createdSectionIds}) = 'array' and jsonb_typeof(${t.createdLabelIds}) = 'array'`,
		),
	],
);

export const importItems = pgTable(
	"import_items",
	{
		id: pk(),
		batchId: uuid("batch_id")
			.notNull()
			.references(() => importBatches.id, { onDelete: "cascade" }),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		sourceKey: varchar("source_key", { length: 200 }).notNull(),
		taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
		taskName: varchar("task_name", { length: 500 }).notNull(),
		assigneeIds: jsonb("assignee_ids").$type<string[]>().notNull().default([]),
		labelIds: jsonb("label_ids").$type<string[]>().notNull().default([]),
		attachmentExpected: integer("attachment_expected").notNull().default(0),
		/** Snapshot verze po vytvoření; rollback odmítne mezitím upravený úkol. */
		taskUpdatedAt: timestamp("task_updated_at", { withTimezone: true }).notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("import_items_batch_source_uq").on(t.batchId, t.sourceKey),
		uniqueIndex("import_items_task_uq").on(t.taskId),
		uniqueIndex("import_items_id_batch_uq").on(t.id, t.batchId),
		index("import_items_batch_idx").on(t.batchId),
		index("import_items_project_idx").on(t.projectId),
		check(
			"import_items_attachment_count_valid",
			sql`${t.attachmentExpected} between 0 and 50`,
		),
		check(
			"import_items_json_shape",
			sql`jsonb_typeof(${t.assigneeIds}) = 'array' and jsonb_typeof(${t.labelIds}) = 'array'`,
		),
		foreignKey({
			name: "import_items_batch_project_fk",
			columns: [t.batchId, t.projectId],
			foreignColumns: [importBatches.id, importBatches.projectId],
		}).onDelete("cascade"),
	],
);

/** Přílohy, které wizard skutečně přenesl; rollback tak neodstraní pozdější ruční soubor. */
export const importAttachments = pgTable(
	"import_attachments",
	{
		id: pk(),
		batchId: uuid("batch_id")
			.notNull()
			.references(() => importBatches.id, { onDelete: "cascade" }),
		itemId: uuid("item_id")
			.notNull()
			.references(() => importItems.id, { onDelete: "cascade" }),
		attachmentId: uuid("attachment_id")
			.notNull()
			.references(() => attachments.id, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("import_attachments_attachment_uq").on(t.attachmentId),
		uniqueIndex("import_attachments_item_attachment_uq").on(t.itemId, t.attachmentId),
		index("import_attachments_batch_idx").on(t.batchId),
		foreignKey({
			name: "import_attachments_item_batch_fk",
			columns: [t.itemId, t.batchId],
			foreignColumns: [importItems.id, importItems.batchId],
		}).onDelete("cascade"),
	],
);

export type ImportBatch = typeof importBatches.$inferSelect;
export type ImportItem = typeof importItems.$inferSelect;
