import {
	and,
	auditEvents,
	eq,
	getDb,
	projectMilestones,
	projects,
	sql,
} from "@watson/db";
import { PROJECT_MILESTONE_CONDITIONS } from "@watson/shared";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

const uuid = z.string().uuid();
const date = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine((value) => {
		const parsed = new Date(`${value}T00:00:00Z`);
		return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
	});
const conditionType = z.enum(PROJECT_MILESTONE_CONDITIONS);
const validateConditionShape = (
	body: {
		conditionType: (typeof PROJECT_MILESTONE_CONDITIONS)[number];
		taskId?: string | null;
		targetCount?: number | null;
	},
	context: z.RefinementCtx,
) => {
	if (body.conditionType === "task_completed" && !body.taskId)
		context.addIssue({ code: "custom", path: ["taskId"], message: "task_required" });
	if (body.conditionType !== "task_completed" && body.taskId != null)
		context.addIssue({ code: "custom", path: ["taskId"], message: "task_not_allowed" });
	if (body.conditionType === "completed_count" && body.targetCount == null)
		context.addIssue({ code: "custom", path: ["targetCount"], message: "count_required" });
	if (body.conditionType !== "completed_count" && body.targetCount != null)
		context.addIssue({ code: "custom", path: ["targetCount"], message: "count_not_allowed" });
};
const definitionSchema = z
	.object({
		title: z.string().trim().min(1).max(200),
		conditionType,
		taskId: uuid.nullable().optional(),
		targetCount: z.number().int().min(1).max(100_000).nullable().optional(),
		dueDate: date.nullable().optional(),
		position: z.number().int().min(0).max(999).optional().default(0),
	})
	.strict()
	.superRefine(validateConditionShape);
const createSchema = z
	.object({
		id: uuid,
		title: z.string().trim().min(1).max(200),
		conditionType,
		taskId: uuid.nullable().optional(),
		targetCount: z.number().int().min(1).max(100_000).nullable().optional(),
		dueDate: date.nullable().optional(),
		position: z.number().int().min(0).max(999).optional().default(0),
	})
	.strict()
	.superRefine(validateConditionShape);
const updateSchema = z
	.object({
		expectedUpdatedAt: z.string().datetime({ offset: true }),
		title: z.string().trim().min(1).max(200).optional(),
		conditionType: conditionType.optional(),
		taskId: uuid.nullable().optional(),
		targetCount: z.number().int().min(1).max(100_000).nullable().optional(),
		dueDate: date.nullable().optional(),
		position: z.number().int().min(0).max(999).optional(),
	})
	.strict()
	.refine((body) => Object.keys(body).some((key) => key !== "expectedUpdatedAt"), "nothing_to_update");
const deleteSchema = z
	.object({
		confirm: z.string().max(200),
		expectedUpdatedAt: z.string().datetime({ offset: true }),
	})
	.strict();
const settingsSchema = z
	.object({
		expectedUpdatedAt: z.string().datetime({ offset: true }),
		name: z.string().trim().min(1).max(200).optional(),
		color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
		kind: z.enum(["flow", "goal", "cycle"]).optional(),
		ownerId: uuid.nullable().optional(),
		status: z.enum(["active", "paused", "archive", "done"]).optional(),
		deliveryDate: date.nullable().optional(),
		definitionOfDone: z.string().max(10_000).nullable().optional(),
		milestonesEnabled: z.boolean().optional(),
		urgentAcceptanceEnabled: z.boolean().optional(),
		urgentAcceptancePriority: z.number().int().min(1).max(2).optional(),
	})
	.strict()
	.refine((body) => Object.keys(body).some((key) => key !== "expectedUpdatedAt"), "nothing_to_update");

const ROLE_RANK: Record<string, number> = { commenter: 1, editor: 2, manager: 3 };
type Access = { project_id: string; workspace_id: string; role: string };
type MilestoneRow = Access & {
	id: string;
	title: string;
	condition_type: (typeof PROJECT_MILESTONE_CONDITIONS)[number];
	task_id: string | null;
	target_count: number | null;
	due_date: string | null;
	position: number;
	updated_at: string | Date;
};

class ProjectMilestoneError extends Error {
	constructor(
		readonly code: string,
		readonly status: 403 | 404 | 409 | 422,
	) {
		super(code);
	}
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function projectAccess(tx: Tx, projectId: string, userId: string): Promise<Access> {
	const rows = (await tx.execute(sql`
		SELECT p.id AS project_id, p.workspace_id,
		       CASE WHEN w.owner_id = ${userId} OR wm.role::text = 'admin'
		            THEN 'manager' ELSE pm.role::text END AS role
		FROM projects p
		JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
		JOIN workspaces w ON w.id = p.workspace_id
		LEFT JOIN memberships wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${userId}
		WHERE p.id = ${projectId}
		LIMIT 1
	`)) as unknown as Access[];
	if (!rows[0]) throw new ProjectMilestoneError("not_found", 404);
	return rows[0];
}

async function milestoneAccess(tx: Tx, milestoneId: string, userId: string): Promise<MilestoneRow> {
	const rows = (await tx.execute(sql`
		SELECT m.id, m.project_id, p.workspace_id,
		       CASE WHEN w.owner_id = ${userId} OR wm.role::text = 'admin'
		            THEN 'manager' ELSE pm.role::text END AS role,
		       m.title, m.condition_type, m.task_id, m.target_count, m.due_date, m.position, m.updated_at
		FROM project_milestones m
		JOIN projects p ON p.id = m.project_id
		JOIN project_members pm ON pm.project_id = m.project_id AND pm.user_id = ${userId}
		JOIN workspaces w ON w.id = p.workspace_id
		LEFT JOIN memberships wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${userId}
		WHERE m.id = ${milestoneId}
		LIMIT 1
	`)) as unknown as MilestoneRow[];
	if (!rows[0]) throw new ProjectMilestoneError("project_milestone_not_found", 404);
	return rows[0];
}

function requireEditor(role: string) {
	if ((ROLE_RANK[role] ?? 0) < 2) throw new ProjectMilestoneError("forbidden", 403);
}

function requireManager(role: string) {
	if ((ROLE_RANK[role] ?? 0) < 3) throw new ProjectMilestoneError("manager_required", 403);
}

async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
	try {
		return schema.parse(await request.json());
	} catch {
		return null;
	}
}

function sqlState(error: unknown): { code: string | null; message: string } {
	let current: unknown = error;
	let message = error instanceof Error ? error.message : "";
	for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
		const value = current as { code?: unknown; message?: unknown; cause?: unknown };
		if (typeof value.message === "string") message = value.message;
		if (typeof value.code === "string" && /^[0-9A-Z]{5}$/.test(value.code))
			return { code: value.code, message };
		current = value.cause;
	}
	return { code: null, message };
}

function response(error: unknown) {
	if (error instanceof ProjectMilestoneError)
		return { error: error.code, status: error.status } as const;
	const state = sqlState(error);
	if (state.message.includes("project_milestones_incomplete"))
		return { error: "project_milestones_incomplete", status: 409 } as const;
	if (state.code === "23505")
		return { error: "project_milestone_title_conflict", status: 409 } as const;
	if (state.code === "23503")
		return { error: "project_milestone_task_invalid", status: 409 } as const;
	throw error;
}

export const projectMilestoneRoutes = new Hono<{ Variables: { requestId: string } }>();

projectMilestoneRoutes.post("/api/projects/:projectId/milestones", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = await body(c.req.raw, createSchema);
	if (!parsed) return c.json({ error: "invalid_project_milestone" }, 422);
	try {
		const result = await getDb().transaction(async (tx) => {
			const access = await projectAccess(tx, c.req.param("projectId"), session.user.id);
			requireEditor(access.role);
			await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${parsed.id}))`);
			const existing = await tx
				.select()
				.from(projectMilestones)
				.where(eq(projectMilestones.id, parsed.id));
			if (existing[0]) {
				const row = existing[0];
				const same =
					row.projectId === access.project_id &&
					row.title === parsed.title &&
					row.conditionType === parsed.conditionType &&
					row.taskId === (parsed.taskId ?? null) &&
					row.targetCount === (parsed.targetCount ?? null) &&
					row.dueDate === (parsed.dueDate ?? null) &&
					row.position === parsed.position;
				if (!same) throw new ProjectMilestoneError("project_milestone_id_conflict", 409);
				return { milestone: row, replayed: true };
			}
			const count = (await tx.execute(sql`
				SELECT count(*)::int AS count FROM project_milestones WHERE project_id = ${access.project_id}
			`)) as unknown as { count: number }[];
			if ((count[0]?.count ?? 0) >= 50)
				throw new ProjectMilestoneError("project_milestone_limit", 409);
			const [created] = await tx
				.insert(projectMilestones)
				.values({
					id: parsed.id,
					projectId: access.project_id,
					title: parsed.title,
					conditionType: parsed.conditionType,
					taskId: parsed.taskId ?? null,
					targetCount: parsed.targetCount ?? null,
					dueDate: parsed.dueDate ?? null,
					position: parsed.position,
					createdBy: session.user.id,
				})
				.returning();
			if (!created) throw new ProjectMilestoneError("project_milestone_create_failed", 409);
			await tx.insert(auditEvents).values({
				workspaceId: access.workspace_id,
				actorUserId: session.user.id,
				entity: "project_milestones",
				entityId: created.id,
				action: "create",
				diff: {
					projectId: access.project_id,
					title: created.title,
					conditionType: created.conditionType,
					taskId: created.taskId,
					targetCount: created.targetCount,
					dueDate: created.dueDate,
				},
				requestId: c.get("requestId"),
			});
			return { milestone: created, replayed: false };
		});
		return c.json(result, result.replayed ? 200 : 201);
	} catch (error) {
		const handled = response(error);
		return c.json({ error: handled.error }, handled.status);
	}
});

projectMilestoneRoutes.patch("/api/project-milestones/:id", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = await body(c.req.raw, updateSchema);
	if (!parsed) return c.json({ error: "invalid_project_milestone" }, 422);
	try {
		const milestone = await getDb().transaction(async (tx) => {
			const current = await milestoneAccess(tx, c.req.param("id"), session.user.id);
			requireEditor(current.role);
			const candidate = definitionSchema.parse({
				title: parsed.title ?? current.title,
				conditionType: parsed.conditionType ?? current.condition_type,
				taskId: parsed.taskId !== undefined ? parsed.taskId : current.task_id,
				targetCount: parsed.targetCount !== undefined ? parsed.targetCount : current.target_count,
				dueDate: parsed.dueDate !== undefined ? parsed.dueDate : current.due_date,
				position: parsed.position ?? current.position,
			});
			const [updated] = await tx
				.update(projectMilestones)
				.set({
					title: candidate.title,
					conditionType: candidate.conditionType,
					taskId: candidate.taskId ?? null,
					targetCount: candidate.targetCount ?? null,
					dueDate: candidate.dueDate ?? null,
					position: candidate.position,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(projectMilestones.id, current.id),
						eq(projectMilestones.updatedAt, sql`${parsed.expectedUpdatedAt}::timestamptz`),
					),
				)
				.returning();
			if (!updated) throw new ProjectMilestoneError("stale_project_milestone", 409);
			await tx.insert(auditEvents).values({
				workspaceId: current.workspace_id,
				actorUserId: session.user.id,
				entity: "project_milestones",
				entityId: current.id,
				action: "update",
				diff: { projectId: current.project_id, before: current, after: candidate },
				requestId: c.get("requestId"),
			});
			return updated;
		});
		return c.json({ milestone });
	} catch (error) {
		if (error instanceof z.ZodError)
			return c.json({ error: "invalid_project_milestone" }, 422);
		const handled = response(error);
		return c.json({ error: handled.error }, handled.status);
	}
});

projectMilestoneRoutes.delete("/api/project-milestones/:id", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = await body(c.req.raw, deleteSchema);
	if (!parsed) return c.json({ error: "invalid_project_milestone_delete" }, 422);
	try {
		await getDb().transaction(async (tx) => {
			const current = await milestoneAccess(tx, c.req.param("id"), session.user.id);
			requireEditor(current.role);
			if (current.title !== parsed.confirm)
				throw new ProjectMilestoneError("project_milestone_confirmation_mismatch", 409);
			const [deleted] = await tx
				.delete(projectMilestones)
				.where(
					and(
						eq(projectMilestones.id, current.id),
						eq(projectMilestones.updatedAt, sql`${parsed.expectedUpdatedAt}::timestamptz`),
					),
				)
				.returning({ id: projectMilestones.id });
			if (!deleted) throw new ProjectMilestoneError("stale_project_milestone", 409);
			await tx.insert(auditEvents).values({
				workspaceId: current.workspace_id,
				actorUserId: session.user.id,
				entity: "project_milestones",
				entityId: current.id,
				action: "delete",
				diff: {
					projectId: current.project_id,
					title: current.title,
					conditionType: current.condition_type,
				},
				requestId: c.get("requestId"),
			});
		});
		return c.json({ ok: true });
	} catch (error) {
		const handled = response(error);
		return c.json({ error: handled.error }, handled.status);
	}
});

/**
 * Serverová editace nastavení nahrazuje optimistický zápis kritických polí projektu.
 * DB guard tak může uživateli vrátit srozumitelnou chybu místo pozdějšího sync rejectu.
 */
projectMilestoneRoutes.patch("/api/projects/:projectId/settings", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = await body(c.req.raw, settingsSchema);
	if (!parsed) return c.json({ error: "invalid_project_settings" }, 422);
	try {
		const project = await getDb().transaction(async (tx) => {
			const access = await projectAccess(tx, c.req.param("projectId"), session.user.id);
			requireEditor(access.role);
			if (
				parsed.ownerId !== undefined ||
				parsed.status !== undefined ||
				parsed.milestonesEnabled !== undefined ||
				parsed.urgentAcceptanceEnabled !== undefined ||
				parsed.urgentAcceptancePriority !== undefined
			)
				requireManager(access.role);
			if (parsed.ownerId) {
				const owner = (await tx.execute(sql`
					SELECT 1 FROM memberships WHERE workspace_id = ${access.workspace_id} AND user_id = ${parsed.ownerId} LIMIT 1
				`)) as unknown as unknown[];
				if (!owner[0]) throw new ProjectMilestoneError("project_owner_not_in_workspace", 422);
			}
			const current = (
				await tx.select().from(projects).where(eq(projects.id, access.project_id))
			)[0];
			if (!current) throw new ProjectMilestoneError("not_found", 404);
			const values: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
			if (parsed.name !== undefined) values.name = parsed.name;
			if (parsed.color !== undefined) values.color = parsed.color;
			if (parsed.kind !== undefined) values.kind = parsed.kind;
			if (parsed.ownerId !== undefined) values.ownerId = parsed.ownerId;
			if (parsed.status !== undefined) {
				values.status = parsed.status;
				values.archivedAt = parsed.status === "archive" ? new Date() : null;
			}
			if (parsed.deliveryDate !== undefined)
				values.deliveryDate = parsed.deliveryDate ? new Date(`${parsed.deliveryDate}T12:00:00Z`) : null;
			if (parsed.definitionOfDone !== undefined)
				values.definitionOfDone = parsed.definitionOfDone;
			if (parsed.milestonesEnabled !== undefined)
				values.milestonesEnabled = parsed.milestonesEnabled;
			if (parsed.urgentAcceptanceEnabled !== undefined)
				values.urgentAcceptanceEnabled = parsed.urgentAcceptanceEnabled;
			if (parsed.urgentAcceptancePriority !== undefined)
				values.urgentAcceptancePriority = parsed.urgentAcceptancePriority;
			const [updated] = await tx
				.update(projects)
				.set(values)
				.where(
					and(
						eq(projects.id, access.project_id),
						eq(projects.updatedAt, sql`${parsed.expectedUpdatedAt}::timestamptz`),
					),
				)
				.returning();
			if (!updated) throw new ProjectMilestoneError("stale_project_settings", 409);
			await tx.insert(auditEvents).values({
				workspaceId: access.workspace_id,
				actorUserId: session.user.id,
				entity: "projects",
				entityId: access.project_id,
				action: "settings_update",
				diff: {
					changed: Object.keys(parsed).filter((key) => key !== "expectedUpdatedAt"),
					before: {
						name: current.name,
						kind: current.kind,
						ownerId: current.ownerId,
						status: current.status,
						milestonesEnabled: current.milestonesEnabled,
						urgentAcceptanceEnabled: current.urgentAcceptanceEnabled,
						urgentAcceptancePriority: current.urgentAcceptancePriority,
					},
					after: {
						name: updated.name,
						kind: updated.kind,
						ownerId: updated.ownerId,
						status: updated.status,
						milestonesEnabled: updated.milestonesEnabled,
						urgentAcceptanceEnabled: updated.urgentAcceptanceEnabled,
						urgentAcceptancePriority: updated.urgentAcceptancePriority,
					},
				},
				requestId: c.get("requestId"),
			});
			return updated;
		});
		return c.json({ project });
	} catch (error) {
		const handled = response(error);
		return c.json({ error: handled.error }, handled.status);
	}
});
