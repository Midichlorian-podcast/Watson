import { auditEvents, getDb, sql } from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

export const taskBulkCommandRoutes = new Hono<{ Variables: { requestId: string } }>();

const uuid = z.string().uuid();
const bulkActionSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("priority"), priority: z.number().int().min(1).max(4) }).strict(),
	z.object({ kind: z.literal("reschedule"), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
	z.object({ kind: z.literal("complete") }).strict(),
	z.object({ kind: z.literal("assign"), userId: uuid }).strict(),
	z.object({ kind: z.literal("move"), projectId: uuid }).strict(),
	z.object({ kind: z.literal("delete") }).strict(),
]);
const previewSchema = z
	.object({ taskIds: z.array(uuid).min(1).max(100), action: bulkActionSchema })
	.strict();
const executeSchema = previewSchema
	.extend({ operationId: z.string().min(1).max(128), previewHash: z.string().length(64) })
	.strict();
const undoSchema = z.object({ batchId: uuid }).strict();

export type BulkAction = z.infer<typeof bulkActionSchema>;
type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type TaskAccessRow = {
	id: string;
	name: string;
	project_id: string;
	workspace_id: string;
	owner_id: string | null;
	project_role: string | null;
	workspace_role: string | null;
	parent_id: string | null;
	priority: number;
	due_date: string | Date | null;
	recurrence_rule: string | null;
	assignment_mode: string;
	completed_at: string | Date | null;
	status_id: string | null;
	section_id: string | null;
	kind: string;
	updated_at: string | Date;
};
type SkipReason =
	| "already_applied"
	| "already_complete"
	| "recurring_requires_scope"
	| "shared_all_requires_individual"
	| "workflow_step_requires_individual"
	| "blocked_by_dependency";
type Skipped = { id: string; name: string; reason: SkipReason };
type Conflict = { code: string; taskIds: string[] };

class BulkCommandError extends Error {
	constructor(
		readonly code: string,
		readonly status: 403 | 404 | 409 | 422 = 422,
	) {
		super(code);
	}
}

const uuids = (ids: string[]) =>
	sql`ARRAY[${sql.join(
		ids.map((id) => sql`${id}`),
		sql`, `,
	)}]::uuid[]`;

async function sha256(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canEditTask(row: TaskAccessRow, userId: string): boolean {
	return (
		row.owner_id === userId ||
		row.workspace_role === "admin" ||
		row.project_role === "editor" ||
		row.project_role === "manager"
	);
}

function canonicalDate(value: string | Date | null): string | null {
	if (!value) return null;
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	return String(value).slice(0, 10);
}

async function selectedTaskRows(
	tx: Tx,
	taskIds: string[],
	userId: string,
	includeDescendants: boolean,
	lock: boolean,
): Promise<TaskAccessRow[]> {
	const tree = includeDescendants
		? sql`WITH RECURSIVE selected AS (
			SELECT id FROM tasks WHERE id = ANY(${uuids(taskIds)})
			UNION SELECT child.id FROM tasks child JOIN selected parent ON child.parent_id = parent.id
		)`
		: sql`WITH selected AS (SELECT id FROM tasks WHERE id = ANY(${uuids(taskIds)}))`;
	return (await tx.execute(sql`${tree}
		SELECT t.id, t.name, t.project_id, p.workspace_id, w.owner_id,
		       pm.role::text AS project_role, wm.role::text AS workspace_role,
		       t.parent_id, t.priority, t.due_date, t.recurrence_rule,
		       t.assignment_mode::text, t.completed_at, t.status_id, t.section_id,
		       t.kind, t.updated_at
		FROM selected x
		JOIN tasks t ON t.id = x.id
		JOIN projects p ON p.id = t.project_id
		JOIN workspaces w ON w.id = p.workspace_id
		LEFT JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ${userId}
		LEFT JOIN memberships wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${userId}
		ORDER BY t.id
		${lock ? sql`FOR UPDATE OF t` : sql``}`)) as unknown as TaskAccessRow[];
}

async function workflowTaskIds(tx: Tx, taskIds: string[]): Promise<Set<string>> {
	const rows = (await tx.execute(sql`
		SELECT task_id AS id FROM chain_steps WHERE task_id = ANY(${uuids(taskIds)})
	`)) as unknown as { id: string }[];
	return new Set(rows.map((row) => row.id));
}

type BulkPlan = {
	workspaceId: string;
	selectedCount: number;
	treeCount: number;
	rows: TaskAccessRow[];
	applyRows: TaskAccessRow[];
	skipped: Skipped[];
	conflicts: Conflict[];
	warnings: string[];
	previewHash: string;
};

async function buildPlan(
	tx: Tx,
	rawTaskIds: string[],
	action: BulkAction,
	userId: string,
	lock = false,
): Promise<BulkPlan> {
	const taskIds = [...new Set(rawTaskIds)].sort();
	const includeDescendants = action.kind === "move" || action.kind === "delete";
	const rows = await selectedTaskRows(tx, taskIds, userId, includeDescendants, lock);
	const foundRoots = new Set(rows.filter((row) => taskIds.includes(row.id)).map((row) => row.id));
	if (foundRoots.size !== taskIds.length) throw new BulkCommandError("task_not_found", 404);
	if (!rows.every((row) => canEditTask(row, userId))) throw new BulkCommandError("forbidden", 403);
	const workspaceIds = [...new Set(rows.map((row) => row.workspace_id))];
	if (workspaceIds.length !== 1 || !workspaceIds[0])
		throw new BulkCommandError("cross_workspace_batch_not_allowed");
	if (rows.length > 500) throw new BulkCommandError("bulk_tree_too_large");

	const skipped: Skipped[] = [];
	const conflicts: Conflict[] = [];
	const warnings = new Set<string>();
	let applyRows = [...rows];
	const skip = (row: TaskAccessRow, reason: SkipReason) => {
		skipped.push({ id: row.id, name: row.name, reason });
		return false;
	};

	if (action.kind === "priority") {
		applyRows = rows.filter((row) => {
			if (row.recurrence_rule) return skip(row, "recurring_requires_scope");
			if (row.priority === action.priority) return skip(row, "already_applied");
			return true;
		});
	} else if (action.kind === "reschedule") {
		const parsed = new Date(`${action.dueDate}T00:00:00Z`);
		if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== action.dueDate)
			throw new BulkCommandError("invalid_due_date");
		const workflowIds = await workflowTaskIds(tx, rows.map((row) => row.id));
		applyRows = rows.filter((row) => {
			if (row.recurrence_rule) return skip(row, "recurring_requires_scope");
			if (row.kind === "meeting" || workflowIds.has(row.id))
				return skip(row, "workflow_step_requires_individual");
			if (canonicalDate(row.due_date) === action.dueDate) return skip(row, "already_applied");
			return true;
		});
	} else if (action.kind === "complete") {
		const ids = rows.map((row) => row.id);
		const chainIds = await workflowTaskIds(tx, ids);
		const blockedRows = (await tx.execute(sql`
			SELECT DISTINCT d.blocked_task_id AS id
			FROM task_dependencies d
			JOIN tasks blocker ON blocker.id = d.blocking_task_id
			WHERE d.blocked_task_id = ANY(${uuids(ids)}) AND blocker.completed_at IS NULL
		`)) as unknown as { id: string }[];
		const blockedIds = new Set(blockedRows.map((row) => row.id));
		const policyRows = (await tx.execute(sql`
			SELECT task_conflict_policy AS policy FROM workspaces WHERE id = ${workspaceIds[0]} LIMIT 1
		`)) as unknown as { policy: string }[];
		const strict = policyRows[0]?.policy === "strict";
		applyRows = rows.filter((row) => {
			if (row.kind === "meeting") return skip(row, "workflow_step_requires_individual");
			if (row.completed_at) return skip(row, "already_complete");
			if (row.recurrence_rule) return skip(row, "recurring_requires_scope");
			if (row.assignment_mode === "shared_all") return skip(row, "shared_all_requires_individual");
			if (chainIds.has(row.id)) return skip(row, "workflow_step_requires_individual");
			if (blockedIds.has(row.id) && strict) return skip(row, "blocked_by_dependency");
			if (blockedIds.has(row.id)) warnings.add("blocked_tasks_will_complete");
			return true;
		});
	} else if (action.kind === "assign") {
		const workflowIds = await workflowTaskIds(tx, rows.map((row) => row.id));
		const candidates = rows.filter((row) => {
			if (row.recurrence_rule) return skip(row, "recurring_requires_scope");
			if (row.kind === "meeting" || workflowIds.has(row.id))
				return skip(row, "workflow_step_requires_individual");
			if (row.assignment_mode === "shared_all")
				return skip(row, "shared_all_requires_individual");
			return true;
		});
		applyRows = candidates;
		if (candidates.length) {
			const projectIds = [...new Set(candidates.map((row) => row.project_id))];
			const memberships = (await tx.execute(sql`
				SELECT project_id FROM project_members
				WHERE user_id = ${action.userId} AND project_id = ANY(${uuids(projectIds)})
			`)) as unknown as { project_id: string }[];
			const allowedProjects = new Set(memberships.map((row) => row.project_id));
			const invalid = candidates.filter((row) => !allowedProjects.has(row.project_id));
			if (invalid.length)
				conflicts.push({ code: "assignee_not_in_project", taskIds: invalid.map((row) => row.id) });
			const assignmentRows = (await tx.execute(sql`
				SELECT task_id, user_id FROM assignments
				WHERE task_id = ANY(${uuids(candidates.map((row) => row.id))})
				ORDER BY task_id, user_id
			`)) as unknown as { task_id: string; user_id: string }[];
			const byTask = new Map<string, string[]>();
			for (const assignment of assignmentRows)
				byTask.set(assignment.task_id, [
					...(byTask.get(assignment.task_id) ?? []),
					assignment.user_id,
				]);
			applyRows = conflicts.length
				? []
				: candidates.filter((row) => {
						const current = byTask.get(row.id) ?? [];
						if (
							row.assignment_mode === "single" &&
							current.length === 1 &&
							current[0] === action.userId
						)
							return skip(row, "already_applied");
						return true;
					});
		}
	} else if (action.kind === "move") {
		const targetRows = (await tx.execute(sql`
			SELECT p.id, p.workspace_id, w.owner_id, pm.role::text AS project_role,
			       wm.role::text AS workspace_role
			FROM projects p JOIN workspaces w ON w.id = p.workspace_id
			LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
			LEFT JOIN memberships wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${userId}
			WHERE p.id = ${action.projectId} LIMIT 1
		`)) as unknown as TaskAccessRow[];
		const target = targetRows[0];
		if (!target) throw new BulkCommandError("target_project_not_found", 404);
		if (target.workspace_id !== workspaceIds[0]) throw new BulkCommandError("cross_workspace_move");
		if (!canEditTask(target, userId)) throw new BulkCommandError("target_project_forbidden", 403);
		const affectedIds = rows.map((row) => row.id);
		const recurringRows = rows.filter((row) => row.recurrence_rule);
		if (recurringRows.length)
			conflicts.push({
				code: "recurring_scope_required",
				taskIds: recurringRows.map((row) => row.id),
			});
		const externalDeps = (await tx.execute(sql`
			SELECT id FROM task_dependencies
			WHERE (blocking_task_id = ANY(${uuids(affectedIds)}) AND NOT (blocked_task_id = ANY(${uuids(affectedIds)})))
			   OR (blocked_task_id = ANY(${uuids(affectedIds)}) AND NOT (blocking_task_id = ANY(${uuids(affectedIds)})))
		`)) as unknown as { id: string }[];
		if (externalDeps.length)
			conflicts.push({ code: "external_dependencies_block_move", taskIds: affectedIds });
		const workflowIds = await workflowTaskIds(tx, affectedIds);
		const workflowRows = rows.filter((row) => row.kind === "meeting" || workflowIds.has(row.id));
		if (workflowRows.length)
			conflicts.push({
				code: "workflow_steps_block_move",
				taskIds: workflowRows.map((row) => row.id),
			});
		const customValueRows = (await tx.execute(sql`
			SELECT DISTINCT task_id FROM task_custom_field_values
			WHERE task_id = ANY(${uuids(affectedIds)})
		`)) as unknown as { task_id: string }[];
		if (customValueRows.length)
			conflicts.push({
				code: "custom_fields_block_move",
				taskIds: customValueRows.map((row) => row.task_id),
			});
		const pollRows = (await tx.execute(sql`
			SELECT DISTINCT task_id FROM task_polls
			WHERE task_id = ANY(${uuids(affectedIds)})
		`)) as unknown as { task_id: string }[];
		if (pollRows.length)
			conflicts.push({
				code: "polls_block_move",
				taskIds: pollRows.map((row) => row.task_id),
			});
		const invalidAssignees = (await tx.execute(sql`
			SELECT DISTINCT a.task_id
			FROM assignments a
			LEFT JOIN project_members pm ON pm.project_id = ${action.projectId} AND pm.user_id = a.user_id
			WHERE a.task_id = ANY(${uuids(affectedIds)}) AND pm.id IS NULL
		`)) as unknown as { task_id: string }[];
		if (invalidAssignees.length)
			conflicts.push({
				code: "assignees_missing_in_target_project",
				taskIds: invalidAssignees.map((row) => row.task_id),
			});
		if (conflicts.length) applyRows = [];
		else
			applyRows = rows.filter(
				(row) => row.project_id !== action.projectId || skip(row, "already_applied"),
			);
	} else if (action.kind === "delete") {
		const recurringRows = rows.filter((row) => row.recurrence_rule);
		if (recurringRows.length)
			conflicts.push({
				code: "recurring_scope_required",
				taskIds: recurringRows.map((row) => row.id),
			});
		const workflowIds = await workflowTaskIds(tx, rows.map((row) => row.id));
		const workflowRows = rows.filter((row) => row.kind === "meeting" || workflowIds.has(row.id));
		if (workflowRows.length)
			conflicts.push({
				code: "workflow_items_block_delete",
				taskIds: workflowRows.map((row) => row.id),
			});
		if (conflicts.length) applyRows = [];
	}

	const fingerprint = {
		action,
		taskIds,
		rows: rows.map((row) => ({
			id: row.id,
			projectId: row.project_id,
			parentId: row.parent_id,
			priority: row.priority,
			dueDate: canonicalDate(row.due_date),
			recurrenceRule: row.recurrence_rule,
			assignmentMode: row.assignment_mode,
			completedAt: row.completed_at,
			statusId: row.status_id,
			sectionId: row.section_id,
			updatedAt: row.updated_at,
		})),
		applyIds: applyRows.map((row) => row.id),
		skipped,
		conflicts,
	};
	return {
		workspaceId: workspaceIds[0],
		selectedCount: taskIds.length,
		treeCount: rows.length,
		rows,
		applyRows,
		skipped,
		conflicts,
		warnings: [...warnings],
		previewHash: await sha256(fingerprint),
	};
}

function publicPlan(plan: BulkPlan) {
	return {
		previewHash: plan.previewHash,
		selectedCount: plan.selectedCount,
		treeCount: plan.treeCount,
		applyCount: plan.applyRows.length,
		skippedCount: plan.skipped.length,
		canExecute: plan.applyRows.length > 0 && plan.conflicts.length === 0,
		items: plan.applyRows.map((row) => ({ id: row.id, name: row.name })),
		skipped: plan.skipped,
		conflicts: plan.conflicts,
		warnings: plan.warnings,
	};
}

taskBulkCommandRoutes.post("/api/tasks/bulk/preview", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = previewSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_bulk_preview" }, 422);
	try {
		const plan = await getDb().transaction((tx) =>
			buildPlan(tx, parsed.data.taskIds, parsed.data.action, session.user.id),
		);
		return c.json(publicPlan(plan));
	} catch (error) {
		if (error instanceof BulkCommandError) return c.json({ error: error.code }, error.status);
		throw error;
	}
});

const MOVE_CHILD_TABLES = [
	"assignments",
	"comments",
	"comment_decisions",
	"mentions",
	"comment_reactions",
	"attachments",
	"task_occurrence_overrides",
	"task_user_colors",
	"reminders",
	"task_activity",
	"checklist_items",
] as const;

type StateRow = Record<string, unknown>;
type BulkState = {
	tasks: StateRow[];
	assignments?: StateRow[];
	children?: Record<string, StateRow[]>;
	dependencies?: StateRow[];
};

async function currentState(tx: Tx, action: BulkAction, taskIds: string[]): Promise<BulkState> {
	const columns =
		action.kind === "priority"
			? sql`id, priority`
			: action.kind === "reschedule"
				? sql`id, due_date`
				: action.kind === "complete"
					? sql`id, completed_at, status_id`
					: action.kind === "assign"
						? sql`id, assignment_mode`
						: sql`id, project_id, section_id, status_id`;
	const tasks = (await tx.execute(sql`
		SELECT ${columns} FROM tasks WHERE id = ANY(${uuids(taskIds)}) ORDER BY id
	`)) as unknown as StateRow[];
	if (action.kind === "assign") {
		const assignments = (await tx.execute(sql`
			SELECT * FROM assignments WHERE task_id = ANY(${uuids(taskIds)}) ORDER BY task_id, user_id, id
		`)) as unknown as StateRow[];
		return { tasks, assignments };
	}
	if (action.kind === "move") {
		const children: Record<string, StateRow[]> = {};
		for (const table of MOVE_CHILD_TABLES) {
			children[table] = (await tx.execute(sql`
				SELECT id, project_id FROM ${sql.raw(table)}
				WHERE task_id = ANY(${uuids(taskIds)}) ORDER BY id
			`)) as unknown as StateRow[];
		}
		const dependencies = (await tx.execute(sql`
			SELECT id, project_id FROM task_dependencies
			WHERE blocking_task_id = ANY(${uuids(taskIds)}) OR blocked_task_id = ANY(${uuids(taskIds)})
			ORDER BY id
		`)) as unknown as StateRow[];
		return { tasks, children, dependencies };
	}
	return { tasks };
}

async function applyAction(tx: Tx, action: BulkAction, taskIds: string[]) {
	if (action.kind === "priority") {
		await tx.execute(sql`
			UPDATE tasks SET priority = ${action.priority}, updated_at = now()
			WHERE id = ANY(${uuids(taskIds)})
		`);
		return;
	}
	if (action.kind === "reschedule") {
		await tx.execute(sql`
			UPDATE tasks SET due_date = ${action.dueDate}::date, updated_at = now()
			WHERE id = ANY(${uuids(taskIds)})
		`);
		return;
	}
	if (action.kind === "complete") {
		await tx.execute(sql`
			UPDATE tasks t SET
				completed_at = now(),
				status_id = COALESCE((
					SELECT s.id FROM statuses s
					WHERE s.project_id = t.project_id AND s.is_done = true
					ORDER BY s.position LIMIT 1
				), t.status_id),
				updated_at = now()
			WHERE t.id = ANY(${uuids(taskIds)})
		`);
		return;
	}
	if (action.kind === "assign") {
		await tx.execute(sql`DELETE FROM assignments WHERE task_id = ANY(${uuids(taskIds)})`);
		await tx.execute(sql`
			INSERT INTO assignments (id, task_id, project_id, user_id, created_at)
			SELECT gen_random_uuid(), t.id, t.project_id, ${action.userId}, now()
			FROM tasks t WHERE t.id = ANY(${uuids(taskIds)})
		`);
		await tx.execute(sql`
			UPDATE tasks SET assignment_mode = 'single', updated_at = now()
			WHERE id = ANY(${uuids(taskIds)})
		`);
		return;
	}
	if (action.kind === "move") {
		await tx.execute(sql`
			UPDATE tasks SET project_id = ${action.projectId}, section_id = NULL,
				status_id = NULL, updated_at = now()
			WHERE id = ANY(${uuids(taskIds)})
		`);
		for (const table of MOVE_CHILD_TABLES) {
			await tx.execute(sql`
				UPDATE ${sql.raw(table)} SET project_id = ${action.projectId}
				WHERE task_id = ANY(${uuids(taskIds)})
			`);
		}
		await tx.execute(sql`
			UPDATE task_dependencies SET project_id = ${action.projectId}
			WHERE blocking_task_id = ANY(${uuids(taskIds)}) OR blocked_task_id = ANY(${uuids(taskIds)})
		`);
		return;
	}
	throw new BulkCommandError("delete_uses_task_delete_command");
}

async function restoreState(tx: Tx, action: BulkAction, before: BulkState) {
	if (action.kind === "priority") {
		for (const row of before.tasks)
			await tx.execute(sql`UPDATE tasks SET priority = ${row.priority}, updated_at = now() WHERE id = ${row.id}`);
		return;
	}
	if (action.kind === "reschedule") {
		for (const row of before.tasks)
			await tx.execute(sql`UPDATE tasks SET due_date = ${row.due_date}, updated_at = now() WHERE id = ${row.id}`);
		return;
	}
	if (action.kind === "complete") {
		for (const row of before.tasks)
			await tx.execute(sql`
				UPDATE tasks SET completed_at = ${row.completed_at}, status_id = ${row.status_id}, updated_at = now()
				WHERE id = ${row.id}
			`);
		return;
	}
	if (action.kind === "assign") {
		const ids = before.tasks.map((row) => String(row.id));
		await tx.execute(sql`DELETE FROM assignments WHERE task_id = ANY(${uuids(ids)})`);
		if ((before.assignments?.length ?? 0) > 0) {
			await tx.execute(sql`
				INSERT INTO assignments
				SELECT * FROM jsonb_populate_recordset(
					null::assignments, ${JSON.stringify(before.assignments)}::jsonb
				)
			`);
		}
		for (const row of before.tasks)
			await tx.execute(sql`
				UPDATE tasks SET assignment_mode = ${row.assignment_mode}, updated_at = now() WHERE id = ${row.id}
			`);
		return;
	}
	if (action.kind === "move") {
		await tx.execute(sql`
			UPDATE tasks t SET project_id = x.project_id, section_id = x.section_id,
				status_id = x.status_id, updated_at = now()
			FROM jsonb_to_recordset(${JSON.stringify(before.tasks)}::jsonb)
				AS x(id uuid, project_id uuid, section_id uuid, status_id uuid)
			WHERE t.id = x.id
		`);
		for (const table of MOVE_CHILD_TABLES) {
			for (const row of before.children?.[table] ?? [])
				await tx.execute(sql`
					UPDATE ${sql.raw(table)} SET project_id = ${row.project_id} WHERE id = ${row.id}
				`);
		}
		for (const row of before.dependencies ?? [])
			await tx.execute(sql`UPDATE task_dependencies SET project_id = ${row.project_id} WHERE id = ${row.id}`);
		return;
	}
	throw new BulkCommandError("delete_uses_task_restore_command");
}

taskBulkCommandRoutes.post("/api/tasks/bulk/execute", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = executeSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_bulk_execute" }, 422);
	if (parsed.data.action.kind === "delete")
		return c.json({ error: "delete_uses_task_delete_command" }, 422);
	const taskIds = [...new Set(parsed.data.taskIds)].sort();
	const requestHash = await sha256({ taskIds, action: parsed.data.action });
	try {
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(sql`DELETE FROM task_undo_batches WHERE expires_at < now()`);
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${session.user.id}:${parsed.data.operationId}`}, 0))`,
			);
			const priorRows = (await tx.execute(sql`
				SELECT id, request_hash, snapshot FROM task_undo_batches
				WHERE created_by = ${session.user.id} AND operation_id = ${parsed.data.operationId}
				LIMIT 1
			`)) as unknown as { id: string; request_hash: string; snapshot: Record<string, unknown> }[];
			const prior = priorRows[0];
			if (prior) {
				if (prior.request_hash !== requestHash) throw new BulkCommandError("operation_id_reused", 409);
				return {
					batchId: prior.id,
					replay: true,
					summary: prior.snapshot.summary ?? null,
				};
			}

			const plan = await buildPlan(tx, taskIds, parsed.data.action, session.user.id, true);
			if (plan.previewHash !== parsed.data.previewHash)
				throw new BulkCommandError("bulk_preview_stale", 409);
			if (plan.conflicts.length) throw new BulkCommandError("bulk_conflicts", 409);
			if (!plan.applyRows.length) throw new BulkCommandError("bulk_nothing_to_apply", 409);
			const affectedIds = plan.applyRows.map((row) => row.id);
			const before = await currentState(tx, parsed.data.action, affectedIds);
			await applyAction(tx, parsed.data.action, affectedIds);
			const after = await currentState(tx, parsed.data.action, affectedIds);
			const summary = publicPlan(plan);
			const snapshot = {
				type: "bulk",
				action: parsed.data.action,
				rootTaskIds: taskIds,
				affectedIds,
				projectIds: [...new Set(plan.rows.map((row) => row.project_id))],
				before,
				afterHash: await sha256(after),
				summary,
			};
			const batchRows = (await tx.execute(sql`
				INSERT INTO task_undo_batches
					(id, workspace_id, created_by, operation_id, request_hash, snapshot, expires_at)
				VALUES
					(${crypto.randomUUID()}, ${plan.workspaceId}, ${session.user.id}, ${parsed.data.operationId},
					 ${requestHash}, ${JSON.stringify(snapshot)}::jsonb, now() + interval '24 hours')
				RETURNING id
			`)) as unknown as { id: string }[];
			const batchId = batchRows[0]?.id;
			if (!batchId) throw new Error("bulk_batch_missing");
			await tx.insert(auditEvents).values({
				workspaceId: plan.workspaceId,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "task_bulk_batch",
				entityId: batchId,
				action: parsed.data.action.kind,
				diff: {
					taskIds: affectedIds,
					selectedCount: plan.selectedCount,
					skippedCount: plan.skipped.length,
				},
				requestId: c.get("requestId") ?? null,
			});
			return { batchId, replay: false, summary };
		});
		return c.json({ ok: true, ...result });
	} catch (error) {
		if (error instanceof BulkCommandError) return c.json({ error: error.code }, error.status);
		throw error;
	}
});

taskBulkCommandRoutes.post("/api/tasks/bulk/undo", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = undoSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_bulk_undo" }, 422);
	try {
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${parsed.data.batchId}, 0))`);
			const rows = (await tx.execute(sql`
				SELECT id, workspace_id, created_by, snapshot, restored_at, expires_at
				FROM task_undo_batches WHERE id = ${parsed.data.batchId} FOR UPDATE
			`)) as unknown as {
				id: string;
				workspace_id: string;
				created_by: string;
				snapshot: {
					type?: string;
					action?: BulkAction;
					affectedIds?: string[];
					before?: BulkState;
					afterHash?: string;
				};
				restored_at: Date | null;
				expires_at: Date;
			}[];
			const batch = rows[0];
			if (batch?.snapshot.type !== "bulk") throw new BulkCommandError("bulk_batch_not_found", 404);
			if (batch.created_by !== session.user.id) throw new BulkCommandError("forbidden", 403);
			if (batch.restored_at) return { replay: true };
			if (new Date(batch.expires_at).getTime() <= Date.now())
				throw new BulkCommandError("undo_expired", 409);
			const action = batch.snapshot.action;
			const affectedIds = batch.snapshot.affectedIds;
			const before = batch.snapshot.before;
			if (!action || !affectedIds?.length || !before || !batch.snapshot.afterHash)
				throw new BulkCommandError("invalid_bulk_snapshot", 409);
			const access = await selectedTaskRows(tx, affectedIds, session.user.id, false, true);
			if (access.length !== affectedIds.length) throw new BulkCommandError("task_not_found", 404);
			if (!access.every((row) => canEditTask(row, session.user.id)))
				throw new BulkCommandError("forbidden", 403);
			const current = await currentState(tx, action, affectedIds);
			if ((await sha256(current)) !== batch.snapshot.afterHash)
				throw new BulkCommandError("bulk_undo_stale", 409);
			await restoreState(tx, action, before);
			await tx.execute(sql`UPDATE task_undo_batches SET restored_at = now() WHERE id = ${batch.id}`);
			await tx.insert(auditEvents).values({
				workspaceId: batch.workspace_id,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "task_bulk_batch",
				entityId: batch.id,
				action: "undo",
				diff: { taskIds: affectedIds, originalAction: action.kind },
				requestId: c.get("requestId") ?? null,
			});
			return { replay: false };
		});
		return c.json({ ok: true, ...result });
	} catch (error) {
		if (error instanceof BulkCommandError) return c.json({ error: error.code }, error.status);
		throw error;
	}
});
