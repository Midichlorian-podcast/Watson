/**
 * Spolupráce: komentáře (Markdown, BEZ CRDT v MVP), @zmínky, přílohy, připomínky.
 * §12 — verzování příloh a hlasovky až v2 (sloupec `version` ale držíme).
 */
import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	index,
	integer,
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
import { projects } from "./workspace";

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
		authorId: uuid("author_id").references(() => users.id, {
			onDelete: "set null",
		}),
		/** Markdown přes PowerSync (LWW). */
		body: text("body").notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index("comments_task_idx").on(t.taskId),
		index("comments_project_idx").on(t.projectId),
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
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
	},
	(t) => [uniqueIndex("mentions_comment_user_uq").on(t.commentId, t.userId)],
);

export const attachments = pgTable("attachments", {
	id: pk(),
	taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
	commentId: uuid("comment_id").references(() => comments.id, {
		onDelete: "cascade",
	}),
	url: text("url").notNull(),
	/** F2 — verzování až v2; default 1. */
	version: integer("version").notNull().default(1),
	mime: varchar("mime", { length: 160 }),
	sizeBytes: bigint("size_bytes", { mode: "number" }),
	uploadedBy: uuid("uploaded_by").references(() => users.id, {
		onDelete: "set null",
	}),
	createdAt: createdAt(),
});

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
		lastErrorCode: varchar("last_error_code", { length: 64 }),
		providerMessageId: varchar("provider_message_id", { length: 256 }),
		/** Kdy provider potvrdil alespoň jedno doručení. Píše jen server. */
		sentAt: timestamp("sent_at", { withTimezone: true }),
		createdAt: createdAt(),
	},
	(t) => [
		index("reminders_task_idx").on(t.taskId),
		index("reminders_user_idx").on(t.userId),
		check(
			"reminders_delivery_state_valid",
			sql`${t.deliveryState} in ('pending', 'claimed', 'retry', 'sent', 'dead')`,
		),
		check("reminders_attempts_nonnegative", sql`${t.attempts} >= 0`),
		index("reminders_pending_idx")
			.on(t.deliveryState, t.nextAttemptAt, t.remindAt)
			.where(sql`delivery_state in ('pending', 'retry', 'claimed')`),
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
export type Attachment = typeof attachments.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
