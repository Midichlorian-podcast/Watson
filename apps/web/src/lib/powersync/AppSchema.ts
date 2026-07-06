import { column, Schema, Table } from "@powersync/web";

/**
 * Klientské zrcadlo (podmnožina) app tabulek.
 * PowerSync přidává textové `id` PK automaticky — neuvádí se.
 * SQLite nemá boolean → bool sloupce jako integer (0/1), časy jako text (ISO) / null.
 */
const tasks = new Table(
	{
		project_id: column.text,
		section_id: column.text,
		parent_id: column.text,
		name: column.text,
		description: column.text,
		priority: column.integer,
		color: column.text,
		due_date: column.text,
		start_date: column.text,
		deadline: column.text,
		duration_min: column.integer,
		days: column.integer,
		sort_order: column.integer,
		recurrence: column.text,
		recurrence_rule: column.text,
		recurrence_basis: column.text,
		assignment_mode: column.text,
		status_id: column.text,
		completed_at: column.text,
		created_by: column.text,
		created_at: column.text,
	},
	{ indexes: { by_project: ["project_id"] } },
);

/** Projekt (barva = tělo karet úkolů, R6); kind=flow|goal|cycle, status 4-stavový. */
const projects = new Table({
	workspace_id: column.text,
	name: column.text,
	color: column.text,
	icon: column.text,
	default_layout: column.text,
	visibility: column.text,
	kind: column.text,
	owner_id: column.text,
	status: column.text,
	delivery_date: column.text,
	definition_of_done: column.text,
	archived_at: column.text,
	created_at: column.text,
});

const sections = new Table(
	{
		project_id: column.text,
		name: column.text,
		position: column.integer,
		created_at: column.text,
	},
	{ indexes: { by_project: ["project_id"] } },
);

/** Stavy úkolů per projekt; is_done (0/1) provázané se zaškrtnutím úkolu (R9). */
const statuses = new Table(
	{
		scope: column.text,
		project_id: column.text,
		workspace_id: column.text,
		name: column.text,
		color: column.text,
		position: column.integer,
		is_done: column.integer,
		created_at: column.text,
	},
	{ indexes: { by_project: ["project_id"] } },
);

const project_members = new Table(
	{
		project_id: column.text,
		user_id: column.text,
		role: column.text,
		created_at: column.text,
	},
	{ indexes: { by_project: ["project_id"], by_user: ["user_id"] } },
);

/** Detail úkolu (task-children, denormalizovaný project_id pro scoping). */
const assignments = new Table(
	{
		task_id: column.text,
		project_id: column.text,
		user_id: column.text,
		completed_at: column.text,
		created_at: column.text,
	},
	{ indexes: { by_task: ["task_id"], by_project: ["project_id"] } },
);

const comments = new Table(
	{
		task_id: column.text,
		project_id: column.text,
		author_id: column.text,
		body: column.text,
		created_at: column.text,
	},
	{ indexes: { by_task: ["task_id"] } },
);

/** R4 — per-výskyt výjimky opakování (done/skip jednoho výskytu). */
const task_occurrence_overrides = new Table(
	{
		task_id: column.text,
		project_id: column.text,
		occ_date: column.text,
		done: column.integer,
		skipped: column.integer,
		created_at: column.text,
	},
	{ indexes: { by_task: ["task_id"], by_project: ["project_id"] } },
);

/** R6 — per-uživatelská barva úkolu (syncuje se jen vlastní barva). */
const task_user_colors = new Table(
	{
		task_id: column.text,
		project_id: column.text,
		user_id: column.text,
		color: column.text,
		created_at: column.text,
	},
	{ indexes: { by_task: ["task_id"] } },
);

const reminders = new Table(
	{
		task_id: column.text,
		project_id: column.text,
		user_id: column.text,
		type: column.text,
		remind_at: column.text,
		offset_min: column.integer,
		channel: column.text,
		created_at: column.text,
	},
	{ indexes: { by_task: ["task_id"] } },
);

/** Historie úprav úkolu (audit log) — kdo kdy jaké pole změnil. */
const task_activity = new Table(
	{
		task_id: column.text,
		project_id: column.text,
		user_id: column.text,
		field: column.text,
		old_value: column.text,
		new_value: column.text,
		created_at: column.text,
	},
	{ indexes: { by_task: ["task_id"] } },
);

/** Postupy (štafeta) — chains + chain_steps (project-scoped). */
const chains = new Table(
	{
		project_id: column.text,
		workspace_id: column.text,
		template_id: column.text,
		name: column.text,
		description: column.text,
		anchor_date: column.text,
		state: column.text,
		sched_mode: column.text,
		skip_weekend: column.integer,
		created_by: column.text,
		completed_at: column.text,
		created_at: column.text,
	},
	{ indexes: { by_project: ["project_id"] } },
);

const chain_steps = new Table(
	{
		chain_id: column.text,
		task_id: column.text,
		project_id: column.text,
		position: column.integer,
		gate: column.text,
		step_state: column.text,
		anchor_offset: column.integer,
		gap_days: column.integer,
		activated_at: column.text,
		created_at: column.text,
	},
	{ indexes: { by_chain: ["chain_id"], by_project: ["project_id"] } },
);

/** Cíle (workspace-scoped). */
const goals = new Table(
	{
		workspace_id: column.text,
		name: column.text,
		scope: column.text,
		metric: column.text,
		target: column.integer,
		due_date: column.text,
		/** Období — volný text „Q3 2026" (prototyp ř. 1457). */
		period: column.text,
		periodic: column.text,
		/** Začátek běžícího období — reset přes „Obnovit období" (prototyp resetGoalPeriod ř. 2346). */
		period_start: column.text,
		/** Filtry hledáčku cíle (fPerson/fKeyword, prototyp goalTasks ř. 2360). */
		filter_person_id: column.text,
		filter_keyword: column.text,
		owner_id: column.text,
		created_by: column.text,
		created_at: column.text,
	},
	{ indexes: { by_workspace: ["workspace_id"] } },
);
const goal_projects = new Table(
	{ goal_id: column.text, project_id: column.text, workspace_id: column.text },
	{ indexes: { by_goal: ["goal_id"] } },
);
const goal_milestones = new Table(
	{
		goal_id: column.text,
		workspace_id: column.text,
		label: column.text,
		done: column.integer,
		position: column.integer,
		created_at: column.text,
	},
	{ indexes: { by_goal: ["goal_id"] } },
);

export const AppSchema = new Schema({
	tasks,
	projects,
	sections,
	statuses,
	project_members,
	assignments,
	comments,
	task_occurrence_overrides,
	task_user_colors,
	reminders,
	task_activity,
	chains,
	chain_steps,
	goals,
	goal_projects,
	goal_milestones,
});

export type Database = (typeof AppSchema)["types"];
export type TaskRow = Database["tasks"];
export type ProjectRow = Database["projects"];
export type SectionRow = Database["sections"];
export type StatusRow = Database["statuses"];
export type ProjectMemberRow = Database["project_members"];
export type AssignmentRow = Database["assignments"];
export type CommentRow = Database["comments"];
export type ReminderRow = Database["reminders"];
export type TaskUserColorRow = Database["task_user_colors"];
export type TaskActivityRow = Database["task_activity"];
export type ChainRow = Database["chains"];
export type ChainStepRow = Database["chain_steps"];
export type GoalRow = Database["goals"];
export type GoalProjectRow = Database["goal_projects"];
export type GoalMilestoneRow = Database["goal_milestones"];
