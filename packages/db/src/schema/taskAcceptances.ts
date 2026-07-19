/**
 * Volitelná akceptace urgentních úkolů. Formuláře příjmu práce jsou záměrně
 * oddělené: tato tabulka reprezentuje rozhodnutí konkrétního řešitele, zda
 * přijímá odpovědnost za již vzniklý úkol.
 */
import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import { tasks } from "./task";
import { projects } from "./workspace";

export const taskAcceptances = pgTable(
	"task_acceptances",
	{
		id: pk(),
		taskId: uuid("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		/** Denormalizace pro projektový PowerSync bucket. */
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		assigneeId: uuid("assignee_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
		status: varchar("status", { length: 16 }).notNull().default("pending"),
		/** Volitelné lidské vysvětlení rozhodnutí; audit ukládá jen fakt, že poznámka existuje. */
		note: text("note"),
		requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
		respondedAt: timestamp("responded_at", { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		uniqueIndex("task_acceptances_task_assignee_uq").on(t.taskId, t.assigneeId),
		index("task_acceptances_project_idx").on(t.projectId),
		index("task_acceptances_assignee_status_idx").on(t.assigneeId, t.status),
		check(
			"task_acceptances_status_valid",
			sql`${t.status} in ('pending', 'accepted', 'declined', 'cancelled')`,
		),
		check(
			"task_acceptances_response_shape",
			sql`(${t.status} = 'pending' and ${t.respondedAt} is null) or (${t.status} <> 'pending' and ${t.respondedAt} is not null)`,
		),
		check(
			"task_acceptances_note_valid",
			sql`${t.note} is null or char_length(${t.note}) <= 1000`,
		),
		foreignKey({
			name: "task_acceptances_task_project_fk",
			columns: [t.taskId, t.projectId],
			foreignColumns: [tasks.id, tasks.projectId],
		}).onDelete("cascade"),
	],
);

export type TaskAcceptance = typeof taskAcceptances.$inferSelect;
