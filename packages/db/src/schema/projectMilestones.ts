/**
 * Projektové milníky jsou odlišné od strategických goal_milestones. Neobsahují
 * ručně měnitelný stav: splnění se vždy odvozuje z autoritativních úkolů projektu.
 */

import type { ProjectMilestoneCondition } from "@watson/shared";
import { sql } from "drizzle-orm";
import {
	check,
	date,
	foreignKey,
	index,
	integer,
	pgTable,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import { tasks } from "./task";
import { projects } from "./workspace";

export const projectMilestones = pgTable(
	"project_milestones",
	{
		id: pk(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		title: varchar("title", { length: 200 }).notNull(),
		conditionType: varchar("condition_type", { length: 32 })
			.$type<ProjectMilestoneCondition>()
			.notNull(),
		/** Povinné pouze pro task_completed; musí ukazovat do stejného projektu. */
		taskId: uuid("task_id"),
		/** Povinné pouze pro completed_count. */
		targetCount: integer("target_count"),
		/** Volitelný poslední den, do kterého se podmínka musí splnit. */
		dueDate: date("due_date", { mode: "string" }),
		position: integer("position").notNull().default(0),
		createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		uniqueIndex("project_milestones_title_uq").on(t.projectId, sql`lower(${t.title})`),
		index("project_milestones_project_idx").on(t.projectId, t.position),
		index("project_milestones_task_idx").on(t.taskId),
		check(
			"project_milestones_title_valid",
			sql`char_length(trim(${t.title})) between 1 and 200`,
		),
		check("project_milestones_position_valid", sql`${t.position} between 0 and 999`),
		check(
			"project_milestones_condition_shape",
			sql`(
				${t.conditionType} = 'task_completed' and ${t.taskId} is not null and ${t.targetCount} is null
			) or (
				${t.conditionType} = 'completed_count' and ${t.taskId} is null and ${t.targetCount} between 1 and 100000
			) or (
				${t.conditionType} = 'all_tasks_completed' and ${t.taskId} is null and ${t.targetCount} is null
			)`,
		),
		foreignKey({
			name: "project_milestones_task_project_fk",
			columns: [t.taskId, t.projectId],
			foreignColumns: [tasks.id, tasks.projectId],
		}).onDelete("restrict"),
	],
);

export type ProjectMilestone = typeof projectMilestones.$inferSelect;
