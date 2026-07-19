/**
 * Vložitelné ankety na úkolech. Anketa je samostatný objekt, ne vlastní pole:
 * má vlastní otázku, typ odpovědi, uzavření a právě jednu odpověď každého člena.
 */
import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	jsonb,
	pgTable,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import { tasks } from "./task";
import { projects } from "./workspace";

export const POLL_RESPONSE_TYPES = [
	"single_choice",
	"multiple_choice",
	"text",
	"number",
	"date",
] as const;
export type PollResponseType = (typeof POLL_RESPONSE_TYPES)[number];
export type PollOption = { id: string; label: string };

export const taskPolls = pgTable(
	"task_polls",
	{
		id: pk(),
		taskId: uuid("task_id").notNull(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		question: varchar("question", { length: 240 }).notNull(),
		responseType: varchar("response_type", { length: 24 }).$type<PollResponseType>().notNull(),
		options: jsonb("options").$type<PollOption[]>().notNull().default([]),
		closedAt: timestamp("closed_at", { withTimezone: true }),
		createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		uniqueIndex("task_polls_id_task_project_uq").on(t.id, t.taskId, t.projectId),
		index("task_polls_task_idx").on(t.taskId, t.createdAt),
		index("task_polls_project_idx").on(t.projectId),
		foreignKey({
			name: "task_polls_task_project_fk",
			columns: [t.taskId, t.projectId],
			foreignColumns: [tasks.id, tasks.projectId],
		}).onDelete("cascade"),
		check("task_polls_question_valid", sql`char_length(trim(${t.question})) between 1 and 240`),
		check(
			"task_polls_response_type_valid",
			sql`${t.responseType} in ('single_choice', 'multiple_choice', 'text', 'number', 'date')`,
		),
		check(
			"task_polls_options_valid",
			sql`jsonb_typeof(${t.options}) = 'array' and (
				(${t.responseType} in ('single_choice', 'multiple_choice') and jsonb_array_length(${t.options}) between 2 and 20)
				or (${t.responseType} not in ('single_choice', 'multiple_choice') and ${t.options} = '[]'::jsonb)
			)`,
		),
	],
);

export const taskPollResponses = pgTable(
	"task_poll_responses",
	{
		id: pk(),
		pollId: uuid("poll_id").notNull(),
		taskId: uuid("task_id").notNull(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		respondentId: uuid("respondent_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		value: jsonb("value").$type<unknown>().notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		uniqueIndex("task_poll_responses_poll_respondent_uq").on(t.pollId, t.respondentId),
		index("task_poll_responses_task_idx").on(t.taskId),
		index("task_poll_responses_project_idx").on(t.projectId),
		index("task_poll_responses_respondent_idx").on(t.respondentId),
		check(
			"task_poll_responses_value_shape",
			sql`jsonb_typeof(${t.value}) in ('string', 'number', 'array')`,
		),
		foreignKey({
			name: "task_poll_responses_poll_scope_fk",
			columns: [t.pollId, t.taskId, t.projectId],
			foreignColumns: [taskPolls.id, taskPolls.taskId, taskPolls.projectId],
		}).onDelete("cascade"),
	],
);

export type TaskPoll = typeof taskPolls.$inferSelect;
export type TaskPollResponse = typeof taskPollResponses.$inferSelect;
