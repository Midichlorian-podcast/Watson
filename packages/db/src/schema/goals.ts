/**
 * Cíle (goals) — měřitelné cíle počítané z reálných úkolů. Workspace-scoped (ne per-projekt).
 * metric: completion(%)/ontime(%)/count/project; scope: team/project/person/personal.
 * Progres se počítá klientsky z úkolů (viz files/logika/03 §2). Model z prototypu (v `files/CLAUDE.md`
 * jsou cíle v2/OKR — tady je produkční model odvozený z extrakce prototypu).
 */
import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_helpers";
import { users } from "./auth";
import { goalMetricEnum, goalPeriodicEnum, goalScopeEnum } from "./enums";
import { projects, workspaces } from "./workspace";

export const goals = pgTable(
	"goals",
	{
		id: pk(),
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		name: varchar("name", { length: 200 }).notNull(),
		scope: goalScopeEnum("scope").notNull().default("team"),
		metric: goalMetricEnum("metric").notNull().default("count"),
		/** Cílová úroveň (číslo nebo % dle metriky). */
		target: integer("target").notNull().default(0),
		/** Termín cíle. */
		dueDate: timestamp("due_date", { withTimezone: true }),
		/** Období cíle — volný text, např. „Q3 2026" (prototyp ř. 1457, karta ř. 763). */
		period: varchar("period", { length: 60 }),
		periodic: goalPeriodicEnum("periodic").notNull().default("none"),
		/** Začátek běžícího období — „Obnovit období" ho posune na dnešek (prototyp resetGoalPeriod ř. 2346). */
		periodStart: timestamp("period_start", { withTimezone: true }),
		/** Filtr hledáčku: měřený člen (fPerson, prototyp ř. 1446). */
		filterPersonId: uuid("filter_person_id").references(() => users.id, {
			onDelete: "set null",
		}),
		/** Filtr hledáčku: klíčové slovo v názvu úkolu (fKeyword, prototyp ř. 1450). */
		filterKeyword: varchar("filter_keyword", { length: 120 }),
		/** Pro scope=person: konkrétní osoba. */
		ownerId: uuid("owner_id").references(() => users.id, {
			onDelete: "set null",
		}),
		createdBy: uuid("created_by").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index("goals_workspace_idx").on(t.workspaceId)],
);

/** Pro metric=project: cíl může pokrývat víc projektů. */
export const goalProjects = pgTable(
	"goal_projects",
	{
		id: pk(),
		goalId: uuid("goal_id")
			.notNull()
			.references(() => goals.id, { onDelete: "cascade" }),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		/** Denormalizace pro PowerSync scoping (workspace bucket). */
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
	},
	(t) => [index("goal_projects_goal_idx").on(t.goalId)],
);

/** Volitelné milníky cíle. */
export const goalMilestones = pgTable(
	"goal_milestones",
	{
		id: pk(),
		goalId: uuid("goal_id")
			.notNull()
			.references(() => goals.id, { onDelete: "cascade" }),
		/** Denormalizace pro PowerSync scoping. */
		workspaceId: uuid("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		label: varchar("label", { length: 300 }).notNull(),
		done: boolean("done").notNull().default(false),
		position: integer("position").notNull().default(0),
		createdAt: createdAt(),
	},
	(t) => [index("goal_milestones_goal_idx").on(t.goalId)],
);

export type Goal = typeof goals.$inferSelect;
export type GoalProject = typeof goalProjects.$inferSelect;
export type GoalMilestone = typeof goalMilestones.$inferSelect;
