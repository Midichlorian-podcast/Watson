/**
 * F6 — Rules & Automation Engine.
 *
 * Zásady: projektový scope, pouze manager může pravidlo publikovat, preview nic
 * nemění, runtime znovu ověřuje oprávnění autora publikace, běh je připnutý na
 * neměnnou verzi a každá podporovaná akce má bezpečné Undo se stale kontrolou.
 */
import { createHash, randomUUID } from "node:crypto";
import {
	and,
	auditEvents,
	automationRuleVersions,
	automationRules,
	automationRuns,
	type AutomationAction,
	type AutomationConfig,
	comments,
	eq,
	getDb,
	sql,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

export const automationRoutes = new Hono<{ Variables: { requestId: string } }>();

const uuid = z.string().uuid();
const operationId = z.string().trim().min(8).max(128);
const timezone = z.string().trim().min(1).max(64).refine((value) => {
	try {
		new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());
		return /^(UTC|[A-Za-z_]+\/[A-Za-z0-9_+./-]+)$/.test(value);
	} catch {
		return false;
	}
}, "invalid_timezone");
const triggerSchema = z.object({ type: z.enum(["task_created", "task_completed", "task_reopened"]) }).strict();
const conditionSchema = z.discriminatedUnion("field", [
	z.object({ field: z.literal("priority"), operator: z.literal("equals"), value: z.number().int().min(1).max(4) }).strict(),
	z.object({ field: z.literal("deadline"), operator: z.literal("is_set"), value: z.boolean() }).strict(),
	z.object({ field: z.literal("assignee"), operator: z.literal("is_set"), value: z.boolean() }).strict(),
]);
const actionSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("set_priority"), value: z.number().int().min(1).max(4) }).strict(),
	z.object({ type: z.literal("set_due_offset"), days: z.number().int().min(0).max(365), overwrite: z.boolean() }).strict(),
	z.object({ type: z.literal("add_comment"), body: z.string().trim().min(1).max(2_000) }).strict(),
]);
export const automationConfigSchema = z
	.object({
		timezone,
		trigger: triggerSchema,
		conditions: z.array(conditionSchema).max(8),
		actions: z.array(actionSchema).min(1).max(8),
	})
	.strict()
	.superRefine((config, ctx) => {
		const singletonActions = config.actions.filter((action) => action.type !== "add_comment");
		const unique = new Set(singletonActions.map((action) => action.type));
		if (unique.size !== singletonActions.length) {
			ctx.addIssue({ code: "custom", message: "duplicate_mutating_action" });
		}
	});

const createSchema = z
	.object({
		id: uuid,
		projectId: uuid,
		name: z.string().trim().min(1).max(200),
		description: z.string().trim().max(2_000).nullable().optional(),
		config: automationConfigSchema,
		operationId,
	})
	.strict();
const updateSchema = z
	.object({
		name: z.string().trim().min(1).max(200),
		description: z.string().trim().max(2_000).nullable(),
		config: automationConfigSchema,
		expectedRevision: z.number().int().positive(),
	})
	.strict();
const publishSchema = z
	.object({ expectedRevision: z.number().int().positive(), operationId })
	.strict();
const stateSchema = z
	.object({ state: z.enum(["enabled", "paused", "archived"]), operationId })
	.strict();
const previewSchema = z.object({ taskId: uuid }).strict();
const undoSchema = z.object({ operationId }).strict();

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Access = {
	workspace_id: string;
	project_name: string;
	project_role: string | null;
	workspace_role: string | null;
	is_owner: boolean;
};
type TaskState = {
	id: string;
	project_id: string;
	name: string;
	priority: number;
	due_date: string | Date | null;
	deadline: string | Date | null;
	completed_at: Date | null;
};
type PlannedChange = {
	type: AutomationAction["type"];
	label: string;
	before: unknown;
	after: unknown;
};

class AutomationError extends Error {
	constructor(readonly code: string, readonly status = 409) {
		super(code);
	}
}

function canonicalJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalJson);
	if (value && typeof value === "object" && !(value instanceof Date)) {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, canonicalJson(entry)]),
		);
	}
	return value instanceof Date ? value.toISOString() : value;
}

function hash(value: unknown) {
	return createHash("sha256").update(JSON.stringify(canonicalJson(value))).digest("hex");
}

function isoDate(value: string | Date | null) {
	if (!value) return null;
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	return String(value).slice(0, 10);
}

function localDay(value: Date, zone: string) {
	const parts = new Intl.DateTimeFormat("en", {
		timeZone: zone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(value);
	const read = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? "";
	return `${read("year")}-${read("month")}-${read("day")}`;
}

function addCalendarDays(day: string, offset: number) {
	const [year, month, date] = day.split("-").map(Number);
	const value = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (date ?? 1) + offset));
	return value.toISOString().slice(0, 10);
}

async function projectAccess(db: Db | Tx, projectId: string, userId: string): Promise<Access | null> {
	const rows = (await db.execute(sql`
		SELECT p.workspace_id, p.name AS project_name, pm.role AS project_role,
		       m.role AS workspace_role, (w.owner_id = ${userId}) AS is_owner
		FROM projects p
		JOIN workspaces w ON w.id = p.workspace_id
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
		LEFT JOIN memberships m ON m.workspace_id = p.workspace_id AND m.user_id = ${userId}
		WHERE p.id = ${projectId}
		LIMIT 1
	`)) as unknown as Access[];
	return rows[0] ?? null;
}

function canRead(access: Access | null) {
	return access?.project_role != null;
}

function canManage(access: Access | null) {
	if (!access?.project_role) return false;
	return (
		access.project_role === "manager" ||
		access.workspace_role === "admin" ||
		access.is_owner
	);
}

async function readTask(db: Db | Tx, taskId: string, projectId: string, lock = false) {
	const rows = (await db.execute(sql`
		SELECT id, project_id, name, priority, due_date, deadline, completed_at
		FROM tasks
		WHERE id = ${taskId} AND project_id = ${projectId} AND kind = 'task'
		${lock ? sql`FOR UPDATE` : sql``}
	`)) as unknown as TaskState[];
	return rows[0] ?? null;
}

async function conditionsMatch(
	db: Db | Tx,
	config: AutomationConfig,
	task: TaskState,
): Promise<{ matched: boolean; facts: string[] }> {
	const facts: string[] = [];
	let assigneeCount: number | null = null;
	for (const condition of config.conditions) {
		let matched = false;
		if (condition.field === "priority") {
			matched = task.priority === condition.value;
			facts.push(`Priorita je P${task.priority}: ${matched ? "ano" : "ne"}`);
		} else if (condition.field === "deadline") {
			matched = Boolean(task.deadline) === condition.value;
			facts.push(`Pevný termín ${task.deadline ? "je" : "není"} nastaven: ${matched ? "ano" : "ne"}`);
		} else {
			if (assigneeCount == null) {
				const rows = (await db.execute(
					sql`SELECT count(*)::int AS count FROM assignments WHERE task_id = ${task.id}`,
				)) as unknown as { count: number }[];
				assigneeCount = Number(rows[0]?.count ?? 0);
			}
			matched = (assigneeCount > 0) === condition.value;
			facts.push(`Řešitel ${assigneeCount > 0 ? "je" : "není"} přiřazen: ${matched ? "ano" : "ne"}`);
		}
		if (!matched) return { matched: false, facts };
	}
	return { matched: true, facts };
}

function planActions(config: AutomationConfig, task: TaskState, eventAt: Date): PlannedChange[] {
	const changes: PlannedChange[] = [];
	for (const action of config.actions) {
		if (action.type === "set_priority") {
			if (task.priority === action.value) continue;
			changes.push({
				type: action.type,
				label: `Změnit prioritu z P${task.priority} na P${action.value}`,
				before: task.priority,
				after: action.value,
			});
		} else if (action.type === "set_due_offset") {
			const before = isoDate(task.due_date);
			if (before && !action.overwrite) continue;
			const after = addCalendarDays(localDay(eventAt, config.timezone), action.days);
			if (before === after) continue;
			changes.push({
				type: action.type,
				label: before ? `Přesunout plánované datum z ${before} na ${after}` : `Nastavit plánované datum na ${after}`,
				before,
				after,
			});
		} else {
			changes.push({
				type: action.type,
				label: "Přidat označený automatický komentář",
				before: null,
				after: action.body,
			});
		}
	}
	return changes;
}

function triggerSql(type: AutomationConfig["trigger"]["type"]) {
	if (type === "task_created") return sql`ae.action = 'put' AND ae.before IS NULL`;
	if (type === "task_completed") {
		return sql`ae.action = 'patch' AND ae.diff ? 'completed_at'
			AND ae.diff->>'completed_at' IS NOT NULL AND ae.before->>'completed_at' IS NULL`;
	}
	return sql`ae.action = 'patch' AND ae.diff ? 'completed_at'
		AND ae.diff->'completed_at' = 'null'::jsonb AND ae.before->>'completed_at' IS NOT NULL`;
}

async function latestRuleVersion(db: Db | Tx, ruleId: string) {
	const rows = (await db.execute(sql`
		SELECT id, rule_id, workspace_id, project_id, version, draft_revision, config, published_by,
		       publish_operation_id, publish_request_hash, published_at
		FROM automation_rule_versions
		WHERE rule_id = ${ruleId}
		ORDER BY version DESC
		LIMIT 1
	`)) as unknown as Array<{
		id: string;
		rule_id: string;
		workspace_id: string;
		project_id: string;
		version: number;
		draft_revision: number;
		config: AutomationConfig;
		published_by: string;
		publish_operation_id: string;
		publish_request_hash: string;
		published_at: Date;
	}>;
	return rows[0] ?? null;
}

export async function dispatchAutomationEventsOnce(limitPerRule = 100) {
	const db = getDb();
	const versions = (await db.execute(sql`
		SELECT DISTINCT ON (v.rule_id)
		       v.id, v.rule_id, v.workspace_id, v.project_id, v.config, v.published_at
		FROM automation_rule_versions v
		JOIN automation_rules r ON r.id = v.rule_id
		WHERE r.state = 'enabled'
		ORDER BY v.rule_id, v.version DESC
	`)) as unknown as Array<{
		id: string;
		rule_id: string;
		workspace_id: string;
		project_id: string;
		config: AutomationConfig;
		published_at: Date;
	}>;
	let queued = 0;
	for (const version of versions) {
		const parsed = automationConfigSchema.safeParse(version.config);
		if (!parsed.success) continue;
		const events = (await db.execute(sql`
			SELECT ae.id, ae.entity_id AS task_id
			FROM audit_events ae
			JOIN tasks t ON t.id = ae.entity_id AND t.project_id = ${version.project_id}
			WHERE ae.workspace_id = ${version.workspace_id}
			  AND ae.entity = 'tasks'
			  AND ae.actor_type <> 'system'
			  AND ae.created_at >= ${version.published_at}
			  AND ${triggerSql(parsed.data.trigger.type)}
			  AND NOT EXISTS (
				SELECT 1 FROM automation_runs ar
				WHERE ar.rule_version_id = ${version.id} AND ar.event_id = ae.id
			  )
			ORDER BY ae.created_at, ae.id
			LIMIT ${limitPerRule}
		`)) as unknown as Array<{ id: string; task_id: string }>;
		for (const event of events) {
			const inserted = await db
				.insert(automationRuns)
				.values({
					ruleId: version.rule_id,
					ruleVersionId: version.id,
					workspaceId: version.workspace_id,
					projectId: version.project_id,
					eventId: event.id,
					taskId: event.task_id,
					triggerType: parsed.data.trigger.type,
				})
				.onConflictDoNothing()
				.returning({ id: automationRuns.id });
			queued += inserted.length;
		}
	}
	return { queued };
}

async function executeRun(runId: string) {
	const db = getDb();
	try {
		return await db.transaction(async (tx) => {
			const rows = (await tx.execute(sql`
				SELECT ar.id, ar.status, ar.task_id, ar.project_id, ar.workspace_id,
				       ar.rule_id, ar.rule_version_id, ar.event_id, ar.trigger_type,
				       r.state AS rule_state, v.config, v.published_by, ae.created_at AS event_at
				FROM automation_runs ar
				JOIN automation_rules r ON r.id = ar.rule_id
				JOIN automation_rule_versions v ON v.id = ar.rule_version_id
				JOIN audit_events ae ON ae.id = ar.event_id
				WHERE ar.id = ${runId}
				FOR UPDATE OF ar
			`)) as unknown as Array<{
				id: string;
				status: string;
				task_id: string;
				project_id: string;
				workspace_id: string;
				rule_id: string;
				rule_version_id: string;
				event_id: string;
				trigger_type: AutomationConfig["trigger"]["type"];
				rule_state: string;
				config: AutomationConfig;
				published_by: string;
				event_at: Date | string;
			}>;
			const run = rows[0];
			if (run?.status !== "queued") return { skipped: true };
			await tx.update(automationRuns).set({ status: "running", startedAt: new Date() }).where(eq(automationRuns.id, run.id));
			const parsed = automationConfigSchema.safeParse(run.config);
			if (!parsed.success) throw new AutomationError("invalid_published_config", 409);
			if (run.rule_state !== "enabled") {
				await tx.update(automationRuns).set({ status: "skipped", errorCode: "rule_not_enabled", completedAt: new Date() }).where(eq(automationRuns.id, run.id));
				return { skipped: true };
			}
			const access = await projectAccess(tx, run.project_id, run.published_by);
			if (!canManage(access)) throw new AutomationError("publisher_permission_revoked", 403);
			const task = await readTask(tx, run.task_id, run.project_id, true);
			if (!task) {
				await tx.update(automationRuns).set({ status: "skipped", errorCode: "task_missing", completedAt: new Date() }).where(eq(automationRuns.id, run.id));
				return { skipped: true };
			}
			const conditionResult = await conditionsMatch(tx, parsed.data, task);
			if (!conditionResult.matched) {
				await tx.update(automationRuns).set({ status: "skipped", errorCode: "conditions_not_met", completedAt: new Date() }).where(eq(automationRuns.id, run.id));
				return { skipped: true };
			}
			const eventAt = run.event_at instanceof Date ? run.event_at : new Date(run.event_at);
			if (Number.isNaN(eventAt.getTime())) throw new AutomationError("invalid_event_time", 409);
			const planned = planActions(parsed.data, task, eventAt);
			if (planned.length === 0) {
				await tx.update(automationRuns).set({ status: "skipped", errorCode: "no_change", completedAt: new Date() }).where(eq(automationRuns.id, run.id));
				return { skipped: true };
			}
			const changes: Array<{ type: AutomationAction["type"]; entityId: string; before: unknown; after: unknown }> = [];
			for (const change of planned) {
				if (change.type === "set_priority") {
					await tx.execute(sql`UPDATE tasks SET priority = ${Number(change.after)}, updated_at = now() WHERE id = ${task.id}`);
					changes.push({ type: change.type, entityId: task.id, before: change.before, after: change.after });
				} else if (change.type === "set_due_offset") {
					await tx.execute(sql`UPDATE tasks SET due_date = ${String(change.after)}::date, updated_at = now() WHERE id = ${task.id}`);
					changes.push({ type: change.type, entityId: task.id, before: change.before, after: change.after });
				} else {
					const commentId = randomUUID();
					await tx.insert(comments).values({
						id: commentId,
						taskId: task.id,
						projectId: run.project_id,
						authorId: run.published_by,
						body: String(change.after),
					});
					changes.push({ type: change.type, entityId: commentId, before: null, after: change.after });
				}
			}
			const result = { taskId: task.id, changes };
			await tx.update(automationRuns).set({
				status: "succeeded",
				result,
				completedAt: new Date(),
				undoExpiresAt: new Date(Date.now() + 24 * 60 * 60_000),
			}).where(eq(automationRuns.id, run.id));
			await tx.insert(auditEvents).values({
				workspaceId: run.workspace_id,
				actorType: "system",
				actorUserId: run.published_by,
				entity: "tasks",
				entityId: task.id,
				action: "automation_apply",
				diff: {
					ruleId: run.rule_id,
					ruleVersionId: run.rule_version_id,
					runId: run.id,
					actions: changes.map((change) => change.type),
				},
			});
			return { succeeded: true };
		});
	} catch (error) {
		const rawCode = (error as { code?: unknown; cause?: { code?: unknown } }).code ??
			(error as { cause?: { code?: unknown } }).cause?.code;
		const safeDbCode = typeof rawCode === "string" && /^[0-9A-Za-z_]{1,16}$/.test(rawCode)
			? rawCode
			: null;
		const code = error instanceof AutomationError
			? error.code
			: safeDbCode
				? `automation_execution_${safeDbCode}`
				: "automation_execution_failed";
		console.error(JSON.stringify({
			level: "error",
			event: "automation_run_failed",
			runId,
			code,
			name: error instanceof Error ? error.name : "UnknownError",
		}));
		await db.execute(sql`
			UPDATE automation_runs
			SET status = 'failed', error_code = ${code}, completed_at = now()
			WHERE id = ${runId} AND status = 'queued'
		`);
		return { failed: true, code };
	}
}

export async function executeAutomationRunsOnce(limit = 50) {
	const rows = (await getDb().execute(sql`
		SELECT id FROM automation_runs WHERE status = 'queued' ORDER BY created_at, id LIMIT ${limit}
	`)) as unknown as { id: string }[];
	for (const row of rows) await executeRun(row.id);
	return { processed: rows.length };
}

export async function runAutomationCycleOnce() {
	const dispatched = await dispatchAutomationEventsOnce();
	const executed = await executeAutomationRunsOnce();
	return { ...dispatched, ...executed };
}

let workerTimer: ReturnType<typeof setInterval> | null = null;
let workerBusy = false;
export function startAutomationWorker(intervalMs = 5_000) {
	if (workerTimer) return;
	workerTimer = setInterval(() => {
		if (workerBusy) return;
		workerBusy = true;
		void runAutomationCycleOnce()
			.catch(() => undefined)
			.finally(() => {
				workerBusy = false;
			});
	}, intervalMs);
	workerTimer.unref?.();
}

automationRoutes.get("/api/automation/rules", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = z.object({ workspaceId: uuid }).strict().safeParse(c.req.query());
	if (!parsed.success) return c.json({ error: "invalid_automation_query" }, 422);
	c.header("Cache-Control", "private, no-store");
	const rows = (await getDb().execute(sql`
		SELECT r.id, r.workspace_id, r.project_id, p.name AS project_name, r.name,
		       r.description, r.state, r.draft_revision, r.draft_config, r.updated_at,
		       latest.id AS published_version_id, latest.version AS published_version,
		       latest.published_at,
		       CASE WHEN pm.role = 'manager' OR m.role = 'admin' OR w.owner_id = ${session.user.id}
		            THEN true ELSE false END AS can_manage,
		       COALESCE(stats.total, 0)::int AS run_total,
		       COALESCE(stats.succeeded, 0)::int AS run_succeeded,
		       COALESCE(stats.failed, 0)::int AS run_failed
		FROM automation_rules r
		JOIN projects p ON p.id = r.project_id
		JOIN workspaces w ON w.id = r.workspace_id
		JOIN project_members pm ON pm.project_id = r.project_id AND pm.user_id = ${session.user.id}
		LEFT JOIN memberships m ON m.workspace_id = r.workspace_id AND m.user_id = ${session.user.id}
		LEFT JOIN LATERAL (
			SELECT id, version, published_at FROM automation_rule_versions v
			WHERE v.rule_id = r.id ORDER BY version DESC LIMIT 1
		) latest ON true
		LEFT JOIN LATERAL (
			SELECT count(*) AS total,
			       count(*) FILTER (WHERE status IN ('succeeded', 'undone')) AS succeeded,
			       count(*) FILTER (WHERE status = 'failed') AS failed
			FROM automation_runs ar WHERE ar.rule_id = r.id
		) stats ON true
		WHERE r.workspace_id = ${parsed.data.workspaceId} AND r.state <> 'archived'
		ORDER BY r.updated_at DESC, r.id
	`)) as unknown as unknown[];
	return c.json({ rules: rows });
});

automationRoutes.get("/api/automation/rules/:ruleId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = uuid.safeParse(c.req.param("ruleId"));
	if (!parsed.success) return c.json({ error: "invalid_rule_id" }, 422);
	c.header("Cache-Control", "private, no-store");
	const rows = (await getDb().execute(sql`
		SELECT r.id, r.workspace_id, r.project_id, r.name, r.description, r.state,
		       r.draft_revision, r.draft_config, r.created_at, r.updated_at,
		       p.name AS project_name, pm.role AS project_role, m.role AS workspace_role,
		       CASE WHEN pm.role = 'manager' OR m.role = 'admin' OR w.owner_id = ${session.user.id}
		            THEN true ELSE false END AS can_manage
		FROM automation_rules r
		JOIN projects p ON p.id = r.project_id
		JOIN workspaces w ON w.id = r.workspace_id
		JOIN project_members pm ON pm.project_id = r.project_id AND pm.user_id = ${session.user.id}
		LEFT JOIN memberships m ON m.workspace_id = r.workspace_id AND m.user_id = ${session.user.id}
		WHERE r.id = ${parsed.data}
	`)) as unknown as Record<string, unknown>[];
	const rule = rows[0];
	if (!rule) return c.json({ error: "rule_not_found" }, 404);
	const versions = await getDb().execute(sql`
		SELECT id, version, draft_revision, config, published_by, published_at
		FROM automation_rule_versions WHERE rule_id = ${parsed.data}
		ORDER BY version DESC
	`);
	const runs = await getDb().execute(sql`
		SELECT ar.id, ar.rule_version_id, v.version, ar.task_id, t.name AS task_name,
		       ar.status, ar.trigger_type, ar.error_code, ar.created_at, ar.completed_at,
		       ar.undo_expires_at, ar.undone_at,
		       CASE WHEN ar.status = 'succeeded' AND ar.undo_expires_at > now() THEN true ELSE false END AS can_undo
		FROM automation_runs ar
		JOIN automation_rule_versions v ON v.id = ar.rule_version_id
		LEFT JOIN tasks t ON t.id = ar.task_id
		WHERE ar.rule_id = ${parsed.data}
		ORDER BY ar.created_at DESC, ar.id DESC LIMIT 50
	`);
	const previewTasks = await getDb().execute(sql`
		SELECT id, name FROM tasks
		WHERE project_id = ${String(rule.project_id)} AND kind = 'task'
		ORDER BY updated_at DESC, id DESC LIMIT 100
	`);
	return c.json({ rule, versions, runs, previewTasks });
});

automationRoutes.post("/api/automation/rules", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_automation_rule", issues: parsed.error.issues.map((issue) => issue.message) }, 422);
	const access = await projectAccess(getDb(), parsed.data.projectId, session.user.id);
	if (!canManage(access) || !access) return c.json({ error: canRead(access) ? "forbidden" : "project_not_found" }, canRead(access) ? 403 : 404);
	const requestHash = hash({ ...parsed.data, operationId: undefined });
	try {
		const [rule] = await getDb().transaction(async (tx) => {
			const inserted = await tx.insert(automationRules).values({
				id: parsed.data.id,
				workspaceId: access.workspace_id,
				projectId: parsed.data.projectId,
				name: parsed.data.name,
				description: parsed.data.description ?? null,
				draftConfig: parsed.data.config,
				createdBy: session.user.id,
				createOperationId: parsed.data.operationId,
				createRequestHash: requestHash,
			}).returning();
			await tx.insert(auditEvents).values({
				workspaceId: access.workspace_id,
				actorUserId: session.user.id,
				entity: "automation_rule",
				entityId: parsed.data.id,
				action: "create_draft",
				diff: { projectId: parsed.data.projectId, trigger: parsed.data.config.trigger.type, actionCount: parsed.data.config.actions.length },
				requestId: c.get("requestId") ?? null,
			});
			return inserted;
		});
		return c.json({ ok: true, replay: false, rule }, 201);
	} catch (error) {
		const rows = await getDb()
			.select()
			.from(automationRules)
			.where(
				and(
					eq(automationRules.createdBy, session.user.id),
					eq(automationRules.createOperationId, parsed.data.operationId),
				),
			)
			.limit(1);
		const existing = rows[0];
		if (!existing) throw error;
		if (existing.createRequestHash !== requestHash) return c.json({ error: "operation_id_reused" }, 409);
		return c.json({ ok: true, replay: true, rule: existing });
	}
});

automationRoutes.patch("/api/automation/rules/:ruleId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const ruleId = uuid.safeParse(c.req.param("ruleId"));
	const body = updateSchema.safeParse(await c.req.json().catch(() => null));
	if (!ruleId.success || !body.success) return c.json({ error: "invalid_automation_draft" }, 422);
	try {
		const result = await getDb().transaction(async (tx) => {
			const rows = (await tx.execute(sql`SELECT * FROM automation_rules WHERE id = ${ruleId.data} FOR UPDATE`)) as unknown as Array<{ workspace_id: string; project_id: string; draft_revision: number }>;
			const rule = rows[0];
			if (!rule) throw new AutomationError("rule_not_found", 404);
			if (!canManage(await projectAccess(tx, rule.project_id, session.user.id))) throw new AutomationError("forbidden", 403);
			if (rule.draft_revision !== body.data.expectedRevision) throw new AutomationError("draft_revision_conflict", 409);
			const [updated] = await tx.update(automationRules).set({
				name: body.data.name,
				description: body.data.description,
				draftConfig: body.data.config,
				draftRevision: rule.draft_revision + 1,
			}).where(eq(automationRules.id, ruleId.data)).returning();
			await tx.insert(auditEvents).values({
				workspaceId: rule.workspace_id,
				actorUserId: session.user.id,
				entity: "automation_rule",
				entityId: ruleId.data,
				action: "update_draft",
				diff: { revision: rule.draft_revision + 1, trigger: body.data.config.trigger.type, actionCount: body.data.config.actions.length },
				requestId: c.get("requestId") ?? null,
			});
			return updated;
		});
		return c.json({ ok: true, rule: result });
	} catch (error) {
		if (error instanceof AutomationError) return c.json({ error: error.code }, error.status as 403 | 404 | 409);
		throw error;
	}
});

automationRoutes.post("/api/automation/rules/:ruleId/preview", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const ruleId = uuid.safeParse(c.req.param("ruleId"));
	const body = previewSchema.safeParse(await c.req.json().catch(() => null));
	if (!ruleId.success || !body.success) return c.json({ error: "invalid_automation_preview" }, 422);
	const rows = (await getDb().execute(sql`SELECT project_id, draft_config FROM automation_rules WHERE id = ${ruleId.data}`)) as unknown as Array<{ project_id: string; draft_config: AutomationConfig }>;
	const rule = rows[0];
	if (!rule || !canRead(await projectAccess(getDb(), rule.project_id, session.user.id))) return c.json({ error: "rule_not_found" }, 404);
	const config = automationConfigSchema.safeParse(rule.draft_config);
	if (!config.success) return c.json({ error: "invalid_draft_config" }, 409);
	const task = await readTask(getDb(), body.data.taskId, rule.project_id);
	if (!task) return c.json({ error: "task_not_found" }, 404);
	const conditions = await conditionsMatch(getDb(), config.data, task);
	const changes = conditions.matched ? planActions(config.data, task, new Date()) : [];
	return c.json({
		matched: conditions.matched,
		facts: conditions.facts,
		changes,
		warning: "Preview nic nezměnil. Před skutečným během Watson znovu ověří data i oprávnění.",
	});
});

automationRoutes.post("/api/automation/rules/:ruleId/publish", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const ruleId = uuid.safeParse(c.req.param("ruleId"));
	const body = publishSchema.safeParse(await c.req.json().catch(() => null));
	if (!ruleId.success || !body.success) return c.json({ error: "invalid_automation_publish" }, 422);
	try {
		const result = await getDb().transaction(async (tx) => {
			const existing = (await tx.execute(sql`
				SELECT * FROM automation_rule_versions
				WHERE published_by = ${session.user.id} AND publish_operation_id = ${body.data.operationId}
				LIMIT 1
			`)) as unknown as Array<{ rule_id: string; publish_request_hash: string; version: number; id: string }>;
			const rows = (await tx.execute(sql`SELECT * FROM automation_rules WHERE id = ${ruleId.data} FOR UPDATE`)) as unknown as Array<{ workspace_id: string; project_id: string; draft_revision: number; draft_config: AutomationConfig }>;
			const rule = rows[0];
			if (!rule) throw new AutomationError("rule_not_found", 404);
			if (!canManage(await projectAccess(tx, rule.project_id, session.user.id))) throw new AutomationError("forbidden", 403);
			const requestHash = hash({ ruleId: ruleId.data, expectedRevision: body.data.expectedRevision, config: rule.draft_config });
			if (existing[0]) {
				if (existing[0].rule_id !== ruleId.data || existing[0].publish_request_hash !== requestHash) throw new AutomationError("operation_id_reused", 409);
				return { replay: true, version: existing[0].version, versionId: existing[0].id };
			}
			if (rule.draft_revision !== body.data.expectedRevision) throw new AutomationError("draft_revision_conflict", 409);
			const config = automationConfigSchema.safeParse(rule.draft_config);
			if (!config.success) throw new AutomationError("invalid_draft_config", 409);
			const sameRevision = (await tx.execute(sql`
				SELECT id, version, config FROM automation_rule_versions
				WHERE rule_id = ${ruleId.data} AND draft_revision = ${rule.draft_revision}
				LIMIT 1
			`)) as unknown as Array<{ id: string; version: number; config: AutomationConfig }>;
			if (sameRevision[0]) {
				if (hash(sameRevision[0].config) !== hash(config.data)) throw new AutomationError("published_revision_corrupt", 409);
				return { replay: true, version: sameRevision[0].version, versionId: sameRevision[0].id };
			}
			const latest = await latestRuleVersion(tx, ruleId.data);
			const version = (latest?.version ?? 0) + 1;
			const [published] = await tx.insert(automationRuleVersions).values({
				ruleId: ruleId.data,
				workspaceId: rule.workspace_id,
				projectId: rule.project_id,
				version,
				draftRevision: rule.draft_revision,
				config: config.data,
				publishedBy: session.user.id,
				publishOperationId: body.data.operationId,
				publishRequestHash: requestHash,
			}).returning({ id: automationRuleVersions.id });
			await tx.update(automationRules).set({ state: "enabled" }).where(eq(automationRules.id, ruleId.data));
			await tx.insert(auditEvents).values({
				workspaceId: rule.workspace_id,
				actorUserId: session.user.id,
				entity: "automation_rule",
				entityId: ruleId.data,
				action: "publish",
				diff: { version, revision: rule.draft_revision, trigger: config.data.trigger.type, actionCount: config.data.actions.length, operationId: body.data.operationId },
				requestId: c.get("requestId") ?? null,
			});
			return { replay: false, version, versionId: published?.id };
		});
		return c.json({ ok: true, ...result });
	} catch (error) {
		if (error instanceof AutomationError) return c.json({ error: error.code }, error.status as 403 | 404 | 409);
		throw error;
	}
});

automationRoutes.post("/api/automation/rules/:ruleId/state", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const ruleId = uuid.safeParse(c.req.param("ruleId"));
	const body = stateSchema.safeParse(await c.req.json().catch(() => null));
	if (!ruleId.success || !body.success) return c.json({ error: "invalid_automation_state" }, 422);
	try {
		const result = await getDb().transaction(async (tx) => {
			const rows = (await tx.execute(sql`SELECT workspace_id, project_id, state FROM automation_rules WHERE id = ${ruleId.data} FOR UPDATE`)) as unknown as Array<{ workspace_id: string; project_id: string; state: string }>;
			const rule = rows[0];
			if (!rule) throw new AutomationError("rule_not_found", 404);
			if (!canManage(await projectAccess(tx, rule.project_id, session.user.id))) throw new AutomationError("forbidden", 403);
			if (rule.state === body.data.state) return { replay: true };
			if (body.data.state === "enabled" && !(await latestRuleVersion(tx, ruleId.data))) throw new AutomationError("publish_before_enable", 409);
			await tx.update(automationRules).set({ state: body.data.state }).where(eq(automationRules.id, ruleId.data));
			await tx.insert(auditEvents).values({
				workspaceId: rule.workspace_id,
				actorUserId: session.user.id,
				entity: "automation_rule",
				entityId: ruleId.data,
				action: body.data.state,
				diff: { operationId: body.data.operationId },
				requestId: c.get("requestId") ?? null,
			});
			return { replay: false };
		});
		return c.json({ ok: true, ...result });
	} catch (error) {
		if (error instanceof AutomationError) return c.json({ error: error.code }, error.status as 403 | 404 | 409);
		throw error;
	}
});

automationRoutes.post("/api/automation/runs/:runId/undo", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const runId = uuid.safeParse(c.req.param("runId"));
	const body = undoSchema.safeParse(await c.req.json().catch(() => null));
	if (!runId.success || !body.success) return c.json({ error: "invalid_automation_undo" }, 422);
	try {
		const result = await getDb().transaction(async (tx) => {
			const rows = (await tx.execute(sql`
				SELECT id, workspace_id, project_id, task_id, status, result, undo_expires_at
				FROM automation_runs WHERE id = ${runId.data} FOR UPDATE
			`)) as unknown as Array<{
				id: string;
				workspace_id: string;
				project_id: string;
				task_id: string;
				status: string;
				result: { changes?: Array<{ type: AutomationAction["type"]; entityId: string; before: unknown; after: unknown }> } | null;
				undo_expires_at: Date | string | null;
			}>;
			const run = rows[0];
			if (!run) throw new AutomationError("run_not_found", 404);
			if (!canManage(await projectAccess(tx, run.project_id, session.user.id))) throw new AutomationError("forbidden", 403);
			if (run.status === "undone") return { replay: true };
			if (run.status !== "succeeded" || !run.result?.changes) throw new AutomationError("run_not_undoable", 409);
			const undoExpiresAt = run.undo_expires_at instanceof Date
				? run.undo_expires_at
				: run.undo_expires_at
					? new Date(run.undo_expires_at)
					: null;
			if (!undoExpiresAt || undoExpiresAt.getTime() <= Date.now()) throw new AutomationError("undo_expired", 409);
			const task = await readTask(tx, run.task_id, run.project_id, true);
			if (!task) throw new AutomationError("undo_stale", 409);
			for (const change of [...run.result.changes].reverse()) {
				if (change.type === "set_priority") {
					if (task.priority !== Number(change.after)) throw new AutomationError("undo_stale", 409);
					await tx.execute(sql`UPDATE tasks SET priority = ${Number(change.before)}, updated_at = now() WHERE id = ${task.id}`);
					task.priority = Number(change.before);
				} else if (change.type === "set_due_offset") {
					if (isoDate(task.due_date) !== String(change.after)) throw new AutomationError("undo_stale", 409);
					await tx.execute(sql`UPDATE tasks SET due_date = ${change.before == null ? null : String(change.before)}::date, updated_at = now() WHERE id = ${task.id}`);
					task.due_date = change.before == null ? null : String(change.before);
				} else {
					const deleted = await tx.execute(sql`
						DELETE FROM comments
					WHERE id = ${change.entityId} AND task_id = ${task.id}
					  AND body = ${String(change.after)} AND updated_at = created_at
					RETURNING id
					`);
					if (deleted.length !== 1) throw new AutomationError("undo_stale", 409);
				}
			}
			await tx.update(automationRuns).set({ status: "undone", undoneAt: new Date() }).where(eq(automationRuns.id, run.id));
			await tx.insert(auditEvents).values({
				workspaceId: run.workspace_id,
				actorUserId: session.user.id,
				entity: "automation_run",
				entityId: run.id,
				action: "undo",
				diff: { taskId: run.task_id, operationId: body.data.operationId, actionCount: run.result.changes.length },
				requestId: c.get("requestId") ?? null,
			});
			return { replay: false };
		});
		return c.json({ ok: true, ...result });
	} catch (error) {
		if (error instanceof AutomationError) return c.json({ error: error.code }, error.status as 403 | 404 | 409);
		throw error;
	}
});
