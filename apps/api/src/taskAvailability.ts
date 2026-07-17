import { auditEvents, availabilityTaskOverrides, getDb, sql } from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

export const taskAvailabilityRoutes = new Hono<{ Variables: { requestId: string } }>();

type Db = ReturnType<typeof getDb>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type QueryDb = Db | DbTx;
type Rows = Record<string, unknown>[];

const uuid = z.string().uuid();
const preflightSchema = z
	.object({
		startsAt: z.string().datetime({ offset: true }).nullable().optional(),
		durationMin: z.number().int().min(1).max(10_080).nullable().optional(),
		assigneeIds: z.array(uuid).max(100).optional(),
	})
	.strict();
const overrideSchema = z
	.object({
		id: uuid,
		blockId: uuid,
		assigneeId: uuid,
		reason: z.string().trim().min(8).max(500),
		/** Navrhovaný čas je nutný, protože výjimka vzniká před samotným přeplánováním. */
		startsAt: z.string().datetime({ offset: true }),
		durationMin: z.number().int().min(1).max(10_080).nullable().optional(),
	})
	.strict();
const overrideBatchSchema = z
	.object({
		overrides: z
			.array(
				z
					.object({
						id: uuid,
						blockId: uuid,
						assigneeId: uuid,
					})
					.strict(),
			)
			.min(1)
			.max(100),
		reason: z.string().trim().min(8).max(500),
		startsAt: z.string().datetime({ offset: true }),
		durationMin: z.number().int().min(1).max(10_080).nullable().optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		const ids = new Set<string>();
		const scopes = new Set<string>();
		for (const [index, item] of value.overrides.entries()) {
			if (ids.has(item.id)) {
				ctx.addIssue({ code: "custom", path: ["overrides", index, "id"], message: "duplicate_id" });
			}
			ids.add(item.id);
			const scope = `${item.blockId}:${item.assigneeId}`;
			if (scopes.has(scope)) {
				ctx.addIssue({ code: "custom", path: ["overrides", index], message: "duplicate_scope" });
			}
			scopes.add(scope);
		}
	});

export type TaskAvailabilityConflict = {
	blockId: string;
	assigneeId: string;
	assigneeName: string;
	kind: "focus" | "unavailable" | "absence" | "holiday";
	startsAt: string;
	endsAt: string;
	label: string | null;
	blocking: boolean;
	overridden: boolean;
};

export type TaskAvailabilityResult = {
	policy: "warning" | "strict";
	startsAt: string | null;
	endsAt: string | null;
	conflicts: TaskAvailabilityConflict[];
	canSchedule: boolean;
};

type ProjectAccess = {
	projectId: string;
	workspaceId: string;
	policy: "warning" | "strict";
	canEdit: boolean;
};

function dateIso(value: unknown): string {
	if (value instanceof Date) return value.toISOString();
	return new Date(String(value)).toISOString();
}

const uuidArray = (ids: string[]) =>
	sql`ARRAY[${sql.join(
		ids.map((id) => sql`${id}`),
		sql`, `,
	)}]::uuid[]`;

async function projectAccess(
	db: QueryDb,
	projectId: string,
	userId: string,
): Promise<ProjectAccess | null> {
	const rows = (await db.execute(sql`
			SELECT p.id AS project_id, p.workspace_id, p.visibility::text AS visibility,
			       w.task_conflict_policy AS policy, w.owner_id,
			       pm.role::text AS project_role, wm.role::text AS workspace_role
		FROM projects p
		JOIN workspaces w ON w.id = p.workspace_id
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
		LEFT JOIN memberships wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${userId}
		WHERE p.id = ${projectId}
		LIMIT 1
	`)) as unknown as Rows;
	const row = rows[0];
	if (!row) return null;
	const workspaceOwner = row.owner_id === userId;
	const workspaceMember = workspaceOwner || row.workspace_role != null;
	// Restricted projekt se bez explicitního členství neprozrazuje ani workspace vedení.
	if (!workspaceMember || (row.visibility === "restricted" && row.project_role == null)) return null;
	const canEdit =
		workspaceOwner ||
		row.workspace_role === "admin" ||
		row.project_role === "editor" ||
		row.project_role === "manager";
	return {
		projectId: String(row.project_id),
		workspaceId: String(row.workspace_id),
		policy: row.policy === "strict" ? "strict" : "warning",
		canEdit,
	};
}

async function taskContext(
	db: QueryDb,
	taskId: string,
	userId: string,
): Promise<
	| (ProjectAccess & {
			startsAt: Date | null;
			durationMin: number | null;
		})
	| null
> {
	const rows = (await db.execute(sql`
		SELECT t.project_id, t.start_date, t.duration_min
		FROM tasks t WHERE t.id = ${taskId} LIMIT 1
	`)) as unknown as Rows;
	const task = rows[0];
	if (!task) return null;
	const access = await projectAccess(db, String(task.project_id), userId);
	if (!access) return null;
	return {
		...access,
		startsAt: task.start_date ? new Date(String(task.start_date)) : null,
		durationMin: task.duration_min == null ? null : Number(task.duration_min),
	};
}

async function validateProjectAssignees(db: QueryDb, projectId: string, assigneeIds: string[]) {
	if (assigneeIds.length === 0) return true;
	const rows = (await db.execute(sql`
		SELECT user_id FROM project_members
		WHERE project_id = ${projectId} AND user_id = ANY(${uuidArray(assigneeIds)})
	`)) as unknown as Rows;
	return new Set(rows.map((row) => String(row.user_id))).size === assigneeIds.length;
}

async function assignedUsers(db: QueryDb, taskId: string) {
	const rows = (await db.execute(sql`
		SELECT user_id FROM assignments WHERE task_id = ${taskId} ORDER BY user_id
	`)) as unknown as Rows;
	return rows.map((row) => String(row.user_id));
}

type OverrideItem = { id: string; blockId: string; assigneeId: string };
type OverrideSaveError =
	| "task_not_found"
	| "forbidden"
	| "assignee_not_in_project"
	| "focus_conflict_not_found"
	| "override_id_reused"
	| "override_scope_exists";

/**
 * Uloží jednu či více nouzových výjimek jako jediný command. Nejdřív pod zámky
 * ověří celou dávku a teprve potom zapisuje, takže neplatná položka nezanechá
 * oprávnění pro jiný Focus blok napůl vytvořené.
 */
async function saveAvailabilityOverrides(
	db: Db,
	input: {
		taskId: string;
		actorUserId: string;
		requestId: string;
		items: OverrideItem[];
		reason: string;
		startsAt: string;
		durationMin?: number | null;
	},
) {
	return db.transaction(async (tx) => {
		const context = await taskContext(tx, input.taskId, input.actorUserId);
		if (!context) return { error: "task_not_found" as OverrideSaveError };
		if (!context.canEdit) return { error: "forbidden" as OverrideSaveError };
		const assigneeIds = [...new Set(input.items.map((item) => item.assigneeId))];
		if (!(await validateProjectAssignees(tx, context.projectId, assigneeIds))) {
			return { error: "assignee_not_in_project" as OverrideSaveError };
		}

		const lockKeys = input.items
			.flatMap((item) => [
				`availability-override-id:${item.id}`,
				`availability-override:${context.workspaceId}:${item.blockId}:${input.taskId}:${item.assigneeId}`,
			])
			.sort();
		for (const key of lockKeys) {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
		}

		const proposed = await readTaskAvailabilityConflicts(tx, {
			workspaceId: context.workspaceId,
			policy: context.policy,
			actorUserId: input.actorUserId,
			taskId: input.taskId,
			startsAt: new Date(input.startsAt),
			durationMin: input.durationMin,
			assigneeIds,
		});
		const validated: Array<
			| { item: OverrideItem; replayed: true; override: Record<string, unknown> }
			| { item: OverrideItem; replayed: false }
		> = [];

		// Dvoufázově: jakákoliv chyba skončí dřív, než vznikne první insert.
		for (const item of input.items) {
			const [existingById] = (await tx.execute(sql`
				SELECT o.*, ae.diff AS audit_diff
				FROM availability_task_overrides o
				LEFT JOIN LATERAL (
					SELECT diff FROM audit_events
					WHERE entity = 'availability_task_overrides'
					  AND entity_id = o.id AND action = 'emergency_override'
					ORDER BY created_at DESC LIMIT 1
				) ae ON true
				WHERE o.id = ${item.id} LIMIT 1
			`)) as unknown as Rows;
			if (existingById) {
				const { audit_diff: auditDiffRaw, ...existingOverride } = existingById;
				const auditDiff =
					auditDiffRaw && typeof auditDiffRaw === "object"
						? (auditDiffRaw as Record<string, unknown>)
						: null;
				const same =
					existingById.workspace_id === context.workspaceId &&
					existingById.task_id === input.taskId &&
					existingById.block_id === item.blockId &&
					existingById.assignee_id === item.assigneeId &&
					existingById.reason === input.reason &&
					auditDiff != null &&
					Date.parse(String(auditDiff.proposedStartsAt)) === Date.parse(input.startsAt) &&
					Number(auditDiff.proposedDurationMin) === (input.durationMin ?? 30);
				if (!same) return { error: "override_id_reused" as OverrideSaveError };
				validated.push({ item, replayed: true, override: existingOverride });
				continue;
			}

			const focus = proposed.conflicts.find(
				(conflict) =>
					conflict.blockId === item.blockId &&
					conflict.assigneeId === item.assigneeId &&
					conflict.kind === "focus",
			);
			if (!focus) return { error: "focus_conflict_not_found" as OverrideSaveError };
			const [existingScope] = (await tx.execute(sql`
				SELECT id FROM availability_task_overrides
				WHERE block_id = ${item.blockId}
				  AND task_id = ${input.taskId}
				  AND assignee_id = ${item.assigneeId}
				LIMIT 1
			`)) as unknown as Rows;
			if (existingScope) return { error: "override_scope_exists" as OverrideSaveError };
			validated.push({ item, replayed: false });
		}

		const overrides: unknown[] = [];
		for (const entry of validated) {
			if (entry.replayed) {
				overrides.push(entry.override);
				continue;
			}
			const [override] = await tx
				.insert(availabilityTaskOverrides)
				.values({
					id: entry.item.id,
					workspaceId: context.workspaceId,
					blockId: entry.item.blockId,
					taskId: input.taskId,
					assigneeId: entry.item.assigneeId,
					actorUserId: input.actorUserId,
					reason: input.reason,
				})
				.returning();
			if (!override) throw new Error("availability_override_insert_failed");
			await tx.insert(auditEvents).values({
				workspaceId: context.workspaceId,
				actorUserId: input.actorUserId,
				entity: "availability_task_overrides",
				entityId: override.id,
				action: "emergency_override",
				diff: {
					taskId: input.taskId,
					blockId: entry.item.blockId,
					assigneeId: entry.item.assigneeId,
					reason: input.reason,
					proposedStartsAt: input.startsAt,
					proposedDurationMin: input.durationMin ?? 30,
				},
				requestId: input.requestId,
			});
			overrides.push(override);
		}
		return {
			overrides,
			replayed: validated.every((entry) => entry.replayed),
		};
	});
}

function overrideErrorStatus(error: OverrideSaveError) {
	return error === "forbidden"
		? 403
		: error === "task_not_found"
			? 404
			: error === "assignee_not_in_project" || error === "focus_conflict_not_found"
				? 422
				: 409;
}

/**
 * Jediný serverový výpočet konfliktů pro preflight, sync i příkazové endpointy.
 * Focus Time je vždy blokující, ostatní typy blokují jen ve strict workspace;
 * ve warning workspace se vracejí jako viditelná varování.
 */
export async function readTaskAvailabilityConflicts(
	db: QueryDb,
	input: {
		workspaceId: string;
		policy: "warning" | "strict";
		actorUserId: string;
		taskId?: string | null;
		startsAt: Date | null;
		durationMin?: number | null;
		assigneeIds: string[];
	},
): Promise<TaskAvailabilityResult> {
	const assigneeIds = [...new Set(input.assigneeIds)].sort();
	if (!input.startsAt || assigneeIds.length === 0) {
		return {
			policy: input.policy,
			startsAt: input.startsAt?.toISOString() ?? null,
			endsAt: input.startsAt
				? new Date(input.startsAt.getTime() + (input.durationMin ?? 30) * 60_000).toISOString()
				: null,
			conflicts: [],
			canSchedule: true,
		};
	}
	const endsAt = new Date(input.startsAt.getTime() + (input.durationMin ?? 30) * 60_000);
	const taskId = input.taskId ?? null;
	const rows = (await db.execute(sql`
		SELECT b.id, b.user_id, u.name AS user_name, b.kind, b.starts_at, b.ends_at,
		       CASE WHEN b.visibility = 'team' OR b.user_id = ${input.actorUserId}
		            THEN b.label ELSE NULL END AS safe_label,
		       EXISTS (
			   SELECT 1 FROM availability_task_overrides o
			   WHERE o.block_id = b.id
			     AND o.task_id = ${taskId}::uuid
			     AND o.assignee_id = b.user_id
		   ) AS overridden
		FROM availability_blocks b
		JOIN users u ON u.id = b.user_id
		WHERE b.workspace_id = ${input.workspaceId}
		  AND b.user_id = ANY(${uuidArray(assigneeIds)})
		  AND b.cancelled_at IS NULL
		  AND b.approval_status = 'approved'
		  AND b.starts_at < ${endsAt.toISOString()}::timestamptz
		  AND b.ends_at > ${input.startsAt.toISOString()}::timestamptz
		ORDER BY b.starts_at, b.user_id,
		  CASE b.kind WHEN 'focus' THEN 1 WHEN 'absence' THEN 2 WHEN 'unavailable' THEN 3 ELSE 4 END
	`)) as unknown as Rows;
	const conflicts = rows.map((row): TaskAvailabilityConflict => {
		const kind = String(row.kind) as TaskAvailabilityConflict["kind"];
		const overridden = row.overridden === true;
		return {
			blockId: String(row.id),
			assigneeId: String(row.user_id),
			assigneeName: String(row.user_name ?? ""),
			kind,
			startsAt: dateIso(row.starts_at),
			endsAt: dateIso(row.ends_at),
			label: row.safe_label == null ? null : String(row.safe_label),
			blocking: kind === "focus" ? !overridden : input.policy === "strict",
			overridden,
		};
	});
	return {
		policy: input.policy,
		startsAt: input.startsAt.toISOString(),
		endsAt: endsAt.toISOString(),
		conflicts,
		canSchedule: conflicts.every((conflict) => !conflict.blocking),
	};
}

/** Strukturovaný preflight pro offline write gateway; DB trigger zůstává poslední pojistkou. */
export async function preflightAvailabilityForSyncWrite(
	db: QueryDb,
	input: {
		workspaceId: string;
		actorUserId: string;
		table: string;
		op: "PUT" | "PATCH" | "DELETE";
		id: string;
		data: Record<string, unknown>;
	},
): Promise<TaskAvailabilityResult | null> {
	if (input.op === "DELETE" || (input.table !== "tasks" && input.table !== "assignments")) {
		return null;
	}
	const policyRows = (await db.execute(sql`
		SELECT task_conflict_policy AS policy FROM workspaces WHERE id = ${input.workspaceId} LIMIT 1
	`)) as unknown as Rows;
	const policy = policyRows[0]?.policy === "strict" ? "strict" : "warning";
	if (input.table === "tasks") {
		if (
			input.op === "PATCH" &&
			!Object.hasOwn(input.data, "start_date") &&
			!Object.hasOwn(input.data, "duration_min") &&
			!Object.hasOwn(input.data, "project_id")
		) {
			return null;
		}
		const rows = (await db.execute(sql`
			SELECT start_date, duration_min FROM tasks WHERE id = ${input.id} LIMIT 1
		`)) as unknown as Rows;
		const current = rows[0];
		const rawStart = Object.hasOwn(input.data, "start_date")
			? input.data.start_date
			: current?.start_date;
		const rawDuration = Object.hasOwn(input.data, "duration_min")
			? input.data.duration_min
			: current?.duration_min;
		return readTaskAvailabilityConflicts(db, {
			workspaceId: input.workspaceId,
			policy,
			actorUserId: input.actorUserId,
			taskId: input.id,
			startsAt: rawStart == null ? null : new Date(String(rawStart)),
			durationMin: rawDuration == null ? null : Number(rawDuration),
			assigneeIds: await assignedUsers(db, input.id),
		});
	}

	const assignmentRows = (await db.execute(sql`
		SELECT task_id, user_id FROM assignments WHERE id = ${input.id} LIMIT 1
	`)) as unknown as Rows;
	const assignment = assignmentRows[0];
	const taskId = String(input.data.task_id ?? assignment?.task_id ?? "");
	const assigneeId = String(input.data.user_id ?? assignment?.user_id ?? "");
	if (!uuid.safeParse(taskId).success || !uuid.safeParse(assigneeId).success) return null;
	const taskRows = (await db.execute(sql`
		SELECT t.start_date, t.duration_min, p.workspace_id
		FROM tasks t JOIN projects p ON p.id = t.project_id
		WHERE t.id = ${taskId} LIMIT 1
	`)) as unknown as Rows;
	const task = taskRows[0];
	if (!task || task.workspace_id !== input.workspaceId) return null;
	return readTaskAvailabilityConflicts(db, {
		workspaceId: input.workspaceId,
		policy,
		actorUserId: input.actorUserId,
		taskId,
		startsAt: task.start_date == null ? null : new Date(String(task.start_date)),
		durationMin: task.duration_min == null ? null : Number(task.duration_min),
		assigneeIds: [assigneeId],
	});
}

taskAvailabilityRoutes.post("/api/tasks/:taskId/availability/preflight", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const taskId = c.req.param("taskId");
	if (!uuid.safeParse(taskId).success) return c.json({ error: "invalid_task_id" }, 422);
	const parsed = preflightSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_availability_preflight" }, 422);
	const db = getDb();
	const context = await taskContext(db, taskId, session.user.id);
	if (!context) return c.json({ error: "task_not_found" }, 404);
	if (!context.canEdit) return c.json({ error: "forbidden" }, 403);
	const assigneeIds = parsed.data.assigneeIds ?? (await assignedUsers(db, taskId));
	if (!(await validateProjectAssignees(db, context.projectId, assigneeIds))) {
		return c.json({ error: "assignee_not_in_project" }, 422);
	}
	const startsAt =
		parsed.data.startsAt === undefined
			? context.startsAt
			: parsed.data.startsAt === null
				? null
				: new Date(parsed.data.startsAt);
	return c.json(
		await readTaskAvailabilityConflicts(db, {
			workspaceId: context.workspaceId,
			policy: context.policy,
			actorUserId: session.user.id,
			taskId,
			startsAt,
			durationMin:
				parsed.data.durationMin === undefined ? context.durationMin : parsed.data.durationMin,
			assigneeIds,
		}),
	);
});

taskAvailabilityRoutes.post("/api/tasks/:taskId/availability-overrides", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const taskId = c.req.param("taskId");
	if (!uuid.safeParse(taskId).success) return c.json({ error: "invalid_task_id" }, 422);
	const parsed = overrideSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_availability_override" }, 422);
	const result = await saveAvailabilityOverrides(getDb(), {
		taskId,
		actorUserId: session.user.id,
		requestId: c.get("requestId"),
		items: [
			{
				id: parsed.data.id,
				blockId: parsed.data.blockId,
				assigneeId: parsed.data.assigneeId,
			},
		],
		reason: parsed.data.reason,
		startsAt: parsed.data.startsAt,
		durationMin: parsed.data.durationMin,
	});
	if ("error" in result && result.error) {
		return c.json(result, overrideErrorStatus(result.error));
	}
	return c.json(
		{ override: result.overrides[0], replayed: result.replayed },
		result.replayed ? 200 : 201,
	);
});

taskAvailabilityRoutes.post("/api/tasks/:taskId/availability-overrides/batch", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const taskId = c.req.param("taskId");
	if (!uuid.safeParse(taskId).success) return c.json({ error: "invalid_task_id" }, 422);
	const parsed = overrideBatchSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_availability_override_batch" }, 422);
	const result = await saveAvailabilityOverrides(getDb(), {
		taskId,
		actorUserId: session.user.id,
		requestId: c.get("requestId"),
		items: parsed.data.overrides,
		reason: parsed.data.reason,
		startsAt: parsed.data.startsAt,
		durationMin: parsed.data.durationMin,
	});
	if ("error" in result && result.error) {
		return c.json(result, overrideErrorStatus(result.error));
	}
	return c.json(result, result.replayed ? 200 : 201);
});
