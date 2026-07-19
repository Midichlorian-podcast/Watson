/**
 * Spolupráce: komentáře (Markdown, BEZ CRDT v MVP), @zmínky, přílohy, připomínky.
 * §12 — verzování příloh a hlasovky až v2 (sloupec `version` ale držíme).
 */
import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	bigint,
	check,
	customType,
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
import { notificationChannelEnum, reminderTypeEnum } from "./enums";
import { tasks } from "./task";
import { projects, workspaces } from "./workspace";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
	dataType: () => "bytea",
});

/**
 * Orientovaná závislost: blocking_task_id musí být dokončen dřív než blocked_task_id.
 * V1 záměrně drží obě strany ve stejném projektu — neprozradí restricted projekt a
 * dovolí bezpečný offline sync. Cyklus navíc odmítá DB trigger v migraci.
 */
export const taskDependencies = pgTable(
	"task_dependencies",
	{
		id: pk(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		blockingTaskId: uuid("blocking_task_id").notNull(),
		blockedTaskId: uuid("blocked_task_id").notNull(),
		createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("task_dependencies_pair_uq").on(t.blockingTaskId, t.blockedTaskId),
		index("task_dependencies_blocking_idx").on(t.blockingTaskId),
		index("task_dependencies_blocked_idx").on(t.blockedTaskId),
		check("task_dependencies_not_self", sql`${t.blockingTaskId} <> ${t.blockedTaskId}`),
		foreignKey({
			name: "task_dependencies_blocking_same_project_fk",
			columns: [t.blockingTaskId, t.projectId],
			foreignColumns: [tasks.id, tasks.projectId],
		}).onDelete("cascade"),
		foreignKey({
			name: "task_dependencies_blocked_same_project_fk",
			columns: [t.blockedTaskId, t.projectId],
			foreignColumns: [tasks.id, tasks.projectId],
		}).onDelete("cascade"),
	],
);

export const comments = pgTable(
	"comments",
	{
		id: pk(),
		taskId: uuid("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		/** Denormalizace pro PowerSync scoping. */
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		/** Vlákno komentářů. UI zakládá odpovědi pod kořen; DB hlídá stejný task i projekt. */
		parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, {
			onDelete: "cascade",
		}),
		authorId: uuid("author_id").references(() => users.id, {
			onDelete: "set null",
		}),
		/** Markdown přes PowerSync (LWW). */
		body: text("body").notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		uniqueIndex("comments_id_task_project_uq").on(t.id, t.taskId, t.projectId),
		index("comments_task_idx").on(t.taskId),
		index("comments_project_idx").on(t.projectId),
		index("comments_parent_idx").on(t.parentId),
		check("comments_not_self_parent", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
		foreignKey({
			name: "comments_parent_same_task_project_fk",
			columns: [t.parentId, t.taskId, t.projectId],
			foreignColumns: [t.id, t.taskId, t.projectId],
		}).onDelete("cascade"),
	],
);

/**
 * Komentář označený jako týmové rozhodnutí. Samostatný řádek zachovává původní
 * komentář beze změny a nese autora i čas označení pro budoucí Decision Log.
 */
export const commentDecisions = pgTable(
	"comment_decisions",
	{
		id: pk(),
		commentId: uuid("comment_id")
			.notNull()
			.references(() => comments.id, { onDelete: "cascade" }),
		taskId: uuid("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		/** Denormalizace pro PowerSync scoping. */
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		markedBy: uuid("marked_by").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("comment_decisions_comment_uq").on(t.commentId),
		index("comment_decisions_task_idx").on(t.taskId),
		index("comment_decisions_project_idx").on(t.projectId),
	],
);

/**
 * F6 Decision Log — kanonický, dohledatelný snapshot rozhodnutí z komentáře,
 * porady nebo ručního zápisu. Zdrojový objekt může později zmizet; proto je jeho
 * UUID historická reference bez FK a `title` zůstává neměnným snapshotem.
 */
export const decisions = pgTable(
	"decisions",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		sourceType: varchar("source_type", { length: 24 }).notNull(),
		sourceObjectId: uuid("source_object_id"),
		sourceKey: varchar("source_key", { length: 128 }).notNull().default("0"),
		title: text("title").notNull(),
		rationale: text("rationale"),
		ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
		decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
		effectiveAt: timestamp("effective_at", { withTimezone: true }),
		reviewAt: timestamp("review_at", { withTimezone: true }),
		status: varchar("status", { length: 24 }).notNull().default("active"),
		supersedesId: uuid("supersedes_id").references((): AnyPgColumn => decisions.id, {
			onDelete: "set null",
		}),
		createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
		version: integer("version").notNull().default(1),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		check("decisions_source_type_valid", sql`${t.sourceType} in ('manual', 'comment', 'meeting')`),
		check(
			"decisions_source_consistent",
			sql`(${t.sourceType} = 'manual' AND ${t.sourceObjectId} IS NULL) OR (${t.sourceType} <> 'manual' AND ${t.sourceObjectId} IS NOT NULL)`,
		),
		check("decisions_source_key_valid", sql`length(${t.sourceKey}) between 1 and 128`),
		check("decisions_title_valid", sql`length(trim(${t.title})) between 1 and 2000`),
		check(
			"decisions_rationale_valid",
			sql`${t.rationale} IS NULL OR length(${t.rationale}) <= 10000`,
		),
		check("decisions_status_valid", sql`${t.status} in ('active', 'superseded', 'withdrawn')`),
		check(
			"decisions_not_self_supersede",
			sql`${t.supersedesId} IS NULL OR ${t.supersedesId} <> ${t.id}`,
		),
		check("decisions_version_positive", sql`${t.version} > 0`),
		foreignKey({
			name: "decisions_project_workspace_fk",
			columns: [t.projectId, t.workspaceId],
			foreignColumns: [projects.id, projects.workspaceId],
		}).onDelete("cascade"),
		uniqueIndex("decisions_source_uq")
			.on(t.sourceType, t.sourceObjectId, t.sourceKey)
			.where(sql`${t.sourceObjectId} IS NOT NULL`),
		uniqueIndex("decisions_id_project_uq").on(t.id, t.projectId),
		index("decisions_project_status_idx").on(t.projectId, t.status, t.decidedAt),
		index("decisions_workspace_review_idx").on(t.workspaceId, t.reviewAt),
		index("decisions_owner_idx").on(t.ownerUserId, t.status),
	],
);

/** Task vazby jsou záměrně ve stejném projektu jako rozhodnutí, aby nic neuniklo z restricted projektu. */
export const decisionTaskLinks = pgTable(
	"decision_task_links",
	{
		id: pk(),
		decisionId: uuid("decision_id").notNull(),
		taskId: uuid("task_id").notNull(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		createdAt: createdAt(),
	},
	(t) => [
		foreignKey({
			name: "decision_task_links_decision_project_fk",
			columns: [t.decisionId, t.projectId],
			foreignColumns: [decisions.id, decisions.projectId],
		}).onDelete("cascade"),
		foreignKey({
			name: "decision_task_links_task_project_fk",
			columns: [t.taskId, t.projectId],
			foreignColumns: [tasks.id, tasks.projectId],
		}).onDelete("cascade"),
		uniqueIndex("decision_task_links_pair_uq").on(t.decisionId, t.taskId),
		index("decision_task_links_task_idx").on(t.taskId),
		index("decision_task_links_project_idx").on(t.projectId),
	],
);

/** Idempotentní receipts pro ruční create/review/supersede commandy Decision Logu. */
export const decisionCommandReceipts = pgTable(
	"decision_command_receipts",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
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
		check("decision_receipts_hash_valid", sql`${t.requestHash} ~ '^[0-9a-f]{64}$'`),
		check("decision_receipts_action_valid", sql`${t.action} in ('create', 'review')`),
		check("decision_receipts_response_object", sql`jsonb_typeof(${t.response}) = 'object'`),
		uniqueIndex("decision_receipts_actor_operation_uq").on(t.actorUserId, t.operationId),
		index("decision_receipts_workspace_idx").on(t.workspaceId, t.createdAt),
	],
);

/**
 * Historie úprav úkolu (audit log) — kdo kdy jaké pole změnil.
 * Neměnný záznam (bez updated_at). project_id denormalizace pro PowerSync scoping.
 */
export const taskActivity = pgTable(
	"task_activity",
	{
		id: pk(),
		taskId: uuid("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		/** Denormalizace pro PowerSync scoping (stejný projekt jako úkol). */
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		/** Kdo změnu provedl (zachovat historii i po smazání uživatele). */
		userId: uuid("user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		/** Které pole se změnilo (name/description/due_date/priority/…) nebo akce (created/completed). */
		field: varchar("field", { length: 100 }).notNull(),
		oldValue: text("old_value"),
		newValue: text("new_value"),
		createdAt: createdAt(),
	},
	(t) => [
		index("task_activity_task_idx").on(t.taskId),
		index("task_activity_project_idx").on(t.projectId),
	],
);

export const mentions = pgTable(
	"mentions",
	{
		id: pk(),
		commentId: uuid("comment_id")
			.notNull()
			.references(() => comments.id, { onDelete: "cascade" }),
		taskId: uuid("task_id").notNull(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("mentions_comment_user_uq").on(t.commentId, t.userId),
		index("mentions_user_idx").on(t.userId),
		index("mentions_task_idx").on(t.taskId),
		index("mentions_project_idx").on(t.projectId),
		foreignKey({
			name: "mentions_comment_same_task_project_fk",
			columns: [t.commentId, t.taskId, t.projectId],
			foreignColumns: [comments.id, comments.taskId, comments.projectId],
		}).onDelete("cascade"),
		foreignKey({
			name: "mentions_task_same_project_fk",
			columns: [t.taskId, t.projectId],
			foreignColumns: [tasks.id, tasks.projectId],
		}).onDelete("cascade"),
	],
);

/** Lehká reakce na komentář; pevná sada emoji drží UI i analytiku předvídatelnou. */
export const commentReactions = pgTable(
	"comment_reactions",
	{
		id: pk(),
		commentId: uuid("comment_id")
			.notNull()
			.references(() => comments.id, { onDelete: "cascade" }),
		taskId: uuid("task_id").notNull(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		emoji: varchar("emoji", { length: 8 }).notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("comment_reactions_user_emoji_uq").on(t.commentId, t.userId, t.emoji),
		index("comment_reactions_comment_idx").on(t.commentId),
		index("comment_reactions_task_idx").on(t.taskId),
		index("comment_reactions_project_idx").on(t.projectId),
		check("comment_reactions_emoji_valid", sql`${t.emoji} in ('👍', '❤️', '🎉', '👀')`),
		foreignKey({
			name: "comment_reactions_comment_same_task_project_fk",
			columns: [t.commentId, t.taskId, t.projectId],
			foreignColumns: [comments.id, comments.taskId, comments.projectId],
		}).onDelete("cascade"),
		foreignKey({
			name: "comment_reactions_task_same_project_fk",
			columns: [t.taskId, t.projectId],
			foreignColumns: [tasks.id, tasks.projectId],
		}).onDelete("cascade"),
	],
);

export const attachments = pgTable(
	"attachments",
	{
		id: pk(),
		/** Vlastnící úkol je povinný i u budoucí přílohy komentáře. */
		taskId: uuid("task_id").notNull(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		commentId: uuid("comment_id").references(() => comments.id, {
			onDelete: "cascade",
		}),
		/** Interní, autorizovaná content route; nikdy přímý veřejný object URL. */
		url: text("url").notNull(),
		fileName: varchar("file_name", { length: 255 }).notNull(),
		sha256: varchar("sha256", { length: 64 }).notNull(),
		/** F2 — verzování až v2; default 1. */
		version: integer("version").notNull().default(1),
		mime: varchar("mime", { length: 160 }).notNull(),
		sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
		uploadedBy: uuid("uploaded_by").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
	},
	(t) => [
		index("attachments_task_idx").on(t.taskId),
		index("attachments_project_idx").on(t.projectId),
		index("attachments_comment_idx").on(t.commentId),
		check("attachments_size_valid", sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= 20971520`),
		check("attachments_sha256_valid", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
		foreignKey({
			name: "attachments_task_same_project_fk",
			columns: [t.taskId, t.projectId],
			foreignColumns: [tasks.id, tasks.projectId],
		}).onDelete("cascade"),
		foreignKey({
			name: "attachments_comment_same_task_project_fk",
			columns: [t.commentId, t.taskId, t.projectId],
			foreignColumns: [comments.id, comments.taskId, comments.projectId],
		}).onDelete("cascade"),
	],
);

/** Binární obsah je server-only a nesmí do PowerSync bucketu. */
export const attachmentBlobs = pgTable(
	"attachment_blobs",
	{
		attachmentId: uuid("attachment_id")
			.primaryKey()
			.references(() => attachments.id, { onDelete: "cascade" }),
		data: bytea("data").notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		check(
			"attachment_blobs_size_valid",
			sql`octet_length(${t.data}) > 0 and octet_length(${t.data}) <= 20971520`,
		),
	],
);

/**
 * Upload před vznikem offline-first task řádku. Po syncu se atomicky převede na attachment;
 * nedokončené stagingy expirují a nejsou viditelné ostatním členům projektu.
 */
export const attachmentUploadStages = pgTable(
	"attachment_upload_stages",
	{
		id: pk(),
		desiredTaskId: uuid("desired_task_id").notNull(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		createdBy: uuid("created_by")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		/** Idempotentní receipt po finalizaci; bajty jsou pak uvolněné. */
		finalizedAttachmentId: uuid("finalized_attachment_id"),
		fileName: varchar("file_name", { length: 255 }).notNull(),
		sha256: varchar("sha256", { length: 64 }).notNull(),
		mime: varchar("mime", { length: 160 }).notNull(),
		sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
		data: bytea("data"),
		expiresAt: timestamp("expires_at", { withTimezone: true })
			.notNull()
			.default(sql`now() + interval '24 hours'`),
		createdAt: createdAt(),
	},
	(t) => [
		index("attachment_upload_stages_expiry_idx").on(t.expiresAt),
		index("attachment_upload_stages_creator_idx").on(t.createdBy),
		check(
			"attachment_upload_stages_size_valid",
			sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= 20971520 and (
				(${t.finalizedAttachmentId} is null and ${t.data} is not null and octet_length(${t.data}) = ${t.sizeBytes})
				or (${t.finalizedAttachmentId} is not null and ${t.data} is null)
			)`,
		),
		check("attachment_upload_stages_sha256_valid", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
	],
);

/** E1 — připomínky; výchozí offset per uživatel (drženo na uživateli). */
export const reminders = pgTable(
	"reminders",
	{
		id: pk(),
		taskId: uuid("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		/** Denormalizace pro PowerSync scoping. */
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		type: reminderTypeEnum("type").notNull().default("time"),
		/** Absolutní čas (type=time/recurring). */
		remindAt: timestamp("remind_at", { withTimezone: true }),
		/** Relativní offset v minutách vůči termínu (type=relative). */
		offsetMin: integer("offset_min"),
		channel: notificationChannelEnum("channel").notNull().default("push"),
		/** Serverová delivery state machine; do PowerSync read-modelu se tyto interní sloupce neposílají. */
		deliveryState: varchar("delivery_state", { length: 16 }).notNull().default("pending"),
		attempts: integer("attempts").notNull().default(0),
		nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		/** Připomínka je bezpečně zadržena snooze/quiet/focus politikou, ne chybou provideru. */
		heldAt: timestamp("held_at", { withTimezone: true }),
		heldReason: varchar("held_reason", { length: 32 }),
		lastErrorCode: varchar("last_error_code", { length: 64 }),
		providerMessageId: varchar("provider_message_id", { length: 256 }),
		/** Kdy provider potvrdil push doručení nebo přijetí e-mailu k odeslání. Píše jen server. */
		sentAt: timestamp("sent_at", { withTimezone: true }),
		createdAt: createdAt(),
	},
	(t) => [
		index("reminders_task_idx").on(t.taskId),
		index("reminders_user_idx").on(t.userId),
		check(
			"reminders_delivery_state_valid",
			sql`${t.deliveryState} in ('pending', 'claimed', 'held', 'retry', 'sent', 'dead')`,
		),
		check(
			"reminders_held_shape",
			sql`(${t.deliveryState} = 'held') = (${t.heldAt} is not null and ${t.heldReason} is not null)`,
		),
		check("reminders_attempts_nonnegative", sql`${t.attempts} >= 0`),
		index("reminders_pending_idx")
			.on(t.deliveryState, t.nextAttemptAt, t.remindAt)
			.where(sql`delivery_state in ('pending', 'retry', 'claimed', 'held')`),
	],
);

/**
 * Web Push odběry — server-only, NEsynchronizuje se do klienta (žádné sync rule).
 * Jeden uživatel může mít víc zařízení/prohlížečů; `endpoint` je unikátní, klíče
 * p256dh/auth slouží k šifrování payloadu (RFC 8291).
 */
export const pushSubscriptions = pgTable("push_subscriptions", {
	id: pk(),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	endpoint: text("endpoint").notNull().unique(),
	p256dh: text("p256dh").notNull(),
	auth: text("auth").notNull(),
	userAgent: text("user_agent"),
	createdAt: createdAt(),
});

export type Comment = typeof comments.$inferSelect;
export type Mention = typeof mentions.$inferSelect;
export type CommentReaction = typeof commentReactions.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type AttachmentBlob = typeof attachmentBlobs.$inferSelect;
export type AttachmentUploadStage = typeof attachmentUploadStages.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type TaskDependency = typeof taskDependencies.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
