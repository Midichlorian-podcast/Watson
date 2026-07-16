import { auditEvents, eq, getDb, sql, taskUndoBatches } from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

export const taskCommandRoutes = new Hono<{ Variables: { requestId: string } }>();

const deleteSchema = z
	.object({
		taskIds: z.array(z.string().uuid()).min(1).max(100),
		operationId: z.string().min(1).max(128),
	})
	.strict();
const restoreSchema = z.object({ batchId: z.string().uuid() }).strict();

/** JS string[] musí být explicitní PG uuid[]; přímý bind pole postgres-js neinterpretuje. */
const uuids = (ids: string[]) =>
	sql`ARRAY[${sql.join(
		ids.map((id) => sql`${id}`),
		sql`, `,
	)}]::uuid[]`;

type AccessRow = {
	id: string;
	project_id: string;
	workspace_id: string;
	project_role: string | null;
	workspace_role: string | null;
	owner_id: string | null;
};

async function sha256(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canEditTask(row: AccessRow, userId: string): boolean {
	return (
		row.owner_id === userId ||
		row.workspace_role === "admin" ||
		row.project_role === "editor" ||
		row.project_role === "manager"
	);
}

async function accessForRoots(
	tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
	taskIds: string[],
	userId: string,
): Promise<AccessRow[]> {
	return (await tx.execute(sql`
		SELECT t.id, t.project_id, p.workspace_id, pm.role::text AS project_role,
		       wm.role::text AS workspace_role, w.owner_id
		FROM tasks t
		JOIN projects p ON p.id = t.project_id
		JOIN workspaces w ON w.id = p.workspace_id
		LEFT JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ${userId}
		LEFT JOIN memberships wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${userId}
		WHERE t.id = ANY(${uuids(taskIds)})
	`)) as unknown as AccessRow[];
}

/**
 * Jediný server command pro delete: rekurzivní task strom, sidecar meetingu a všechna
 * podřízená data se snapshotují a smažou v jedné PostgreSQL transakci. Snapshot se
 * nikdy neposílá klientovi; undo používá pouze batchId.
 */
taskCommandRoutes.post("/api/tasks/delete", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = deleteSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_task_delete" }, 422);
	const taskIds = [...new Set(parsed.data.taskIds)].sort();
	const requestHash = await sha256(taskIds);
	const db = getDb();

	const result = await db.transaction(async (tx) => {
		await tx.execute(sql`DELETE FROM task_undo_batches WHERE expires_at < now()`);
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${session.user.id}:${parsed.data.operationId}`}, 0))`,
		);
		const exactPriorRows = (await tx.execute(sql`
			SELECT id, request_hash FROM task_undo_batches
			WHERE created_by = ${session.user.id} AND operation_id = ${parsed.data.operationId}
			LIMIT 1
		`)) as unknown as { id: string; request_hash: string }[];
		const exactPrior = exactPriorRows[0];
		if (exactPrior) {
			if (exactPrior.request_hash !== requestHash) return { conflict: true as const };
			return { batchId: exactPrior.id, replay: true as const };
		}

		const access = await accessForRoots(tx, taskIds, session.user.id);
		if (access.length !== taskIds.length) return { missing: true as const };
		if (!access.every((row) => canEditTask(row, session.user.id)))
			return { forbidden: true as const };
		const workspaceIds = [...new Set(access.map((row) => row.workspace_id))];
		if (workspaceIds.length !== 1) return { multipleWorkspaces: true as const };
		const workspaceId = workspaceIds[0];
		if (!workspaceId) return { missing: true as const };

		// Citlivý meeting smí smazat participant/zakladatel nebo workspace admin/owner.
		const meetingAccess = (await tx.execute(sql`
			WITH RECURSIVE tree AS (
				SELECT id FROM tasks WHERE id = ANY(${uuids(taskIds)})
				UNION SELECT child.id FROM tasks child JOIN tree parent ON child.parent_id = parent.id
			)
			SELECT m.id,
			       (m.created_by = ${session.user.id}) AS creator,
			       EXISTS (SELECT 1 FROM assignments a WHERE a.task_id = m.hub_task_id AND a.user_id = ${session.user.id}) AS participant,
			       (w.owner_id = ${session.user.id}) AS workspace_owner,
			       (wm.role::text = 'admin') AS workspace_admin
			FROM meetings m
			JOIN tree ON tree.id = m.hub_task_id
			JOIN workspaces w ON w.id = m.workspace_id
			LEFT JOIN memberships wm ON wm.workspace_id = m.workspace_id AND wm.user_id = ${session.user.id}
		`)) as unknown as {
			id: string;
			creator: boolean;
			participant: boolean;
			workspace_owner: boolean;
			workspace_admin: boolean;
		}[];
		if (
			meetingAccess.some(
				(row) => !(row.creator || row.participant || row.workspace_owner || row.workspace_admin),
			)
		)
			return { forbidden: true as const };

		const snapshots = (await tx.execute(sql`
			WITH RECURSIVE tree_raw AS (
				SELECT t.*, 0 AS _depth FROM tasks t WHERE t.id = ANY(${uuids(taskIds)})
				UNION ALL
				SELECT child.*, parent._depth + 1 FROM tasks child JOIN tree_raw parent ON child.parent_id = parent.id
			), tree AS (
				SELECT DISTINCT ON (id) * FROM tree_raw ORDER BY id, _depth DESC
			), task_ids AS (SELECT id FROM tree),
			meeting_ids AS (SELECT id FROM meetings WHERE hub_task_id IN (SELECT id FROM task_ids)),
			comment_ids AS (SELECT id FROM comments WHERE task_id IN (SELECT id FROM task_ids))
			SELECT jsonb_build_object(
				'rootTaskIds', to_jsonb(${uuids(taskIds)}),
				'projectIds', (SELECT COALESCE(jsonb_agg(DISTINCT project_id), '[]'::jsonb) FROM tree),
				'tasks', (SELECT COALESCE(jsonb_agg(to_jsonb(tree) - '_depth' ORDER BY _depth, created_at, id), '[]'::jsonb) FROM tree),
				'meetings', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM meetings x WHERE x.id IN (SELECT id FROM meeting_ids)),
				'assignments', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM assignments x WHERE x.task_id IN (SELECT id FROM task_ids)),
				'comments', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM comments x WHERE x.task_id IN (SELECT id FROM task_ids)),
				'commentDecisions', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM comment_decisions x WHERE x.task_id IN (SELECT id FROM task_ids)),
				'mentions', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM mentions x WHERE x.comment_id IN (SELECT id FROM comment_ids)),
				'attachments', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM attachments x WHERE x.task_id IN (SELECT id FROM task_ids) OR x.comment_id IN (SELECT id FROM comment_ids)),
				'reminders', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM reminders x WHERE x.task_id IN (SELECT id FROM task_ids)),
				'taskActivity', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM task_activity x WHERE x.task_id IN (SELECT id FROM task_ids)),
				'taskDependencies', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM task_dependencies x WHERE x.blocking_task_id IN (SELECT id FROM task_ids) OR x.blocked_task_id IN (SELECT id FROM task_ids)),
				'occurrences', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM task_occurrence_overrides x WHERE x.task_id IN (SELECT id FROM task_ids)),
				'colors', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM task_user_colors x WHERE x.task_id IN (SELECT id FROM task_ids)),
				'chainSteps', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM chain_steps x WHERE x.task_id IN (SELECT id FROM task_ids)),
				'calendarLinks', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM calendar_links x WHERE x.task_id IN (SELECT id FROM task_ids)),
				'checklistItems', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM checklist_items x WHERE x.task_id IN (SELECT id FROM task_ids)),
				'taskLabels', (SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM task_labels x WHERE x.task_id IN (SELECT id FROM task_ids)),
				'detachedMeetingTasks', (
					SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'meeting_id', x.meeting_id)), '[]'::jsonb)
					FROM tasks x WHERE x.id NOT IN (SELECT id FROM task_ids) AND x.meeting_id IN (SELECT id::text FROM meeting_ids)
				),
				'detachedNextMeetings', (
					SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'prev_meeting_id', x.prev_meeting_id)), '[]'::jsonb)
					FROM meetings x WHERE x.id NOT IN (SELECT id FROM meeting_ids) AND x.prev_meeting_id IN (SELECT id FROM meeting_ids)
				),
				'entityLinks', (
					SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM entity_links x
					WHERE (x.from_type = 'task' AND x.from_id IN (SELECT id::text FROM task_ids))
					   OR (x.to_type = 'task' AND x.to_id IN (SELECT id::text FROM task_ids))
					   OR (x.from_type = 'meeting' AND x.from_id IN (SELECT id::text FROM meeting_ids))
					   OR (x.to_type = 'meeting' AND x.to_id IN (SELECT id::text FROM meeting_ids))
				)
			) AS snapshot
		`)) as unknown as { snapshot: Record<string, unknown> }[];
		const snapshot = snapshots[0]?.snapshot;
		if (!snapshot) throw new Error("task_delete_snapshot_missing");
		const [batch] = await tx
			.insert(taskUndoBatches)
			.values({
				workspaceId,
				createdBy: session.user.id,
				operationId: parsed.data.operationId,
				requestHash,
				snapshot,
				expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
			})
			.returning({ id: taskUndoBatches.id });
		if (!batch) throw new Error("task_delete_batch_missing");

		await tx.execute(sql`
			WITH RECURSIVE tree AS (
				SELECT id FROM tasks WHERE id = ANY(${uuids(taskIds)})
				UNION SELECT child.id FROM tasks child JOIN tree parent ON child.parent_id = parent.id
			), meeting_ids AS (SELECT id FROM meetings WHERE hub_task_id IN (SELECT id FROM tree))
			DELETE FROM entity_links x
			WHERE (x.from_type = 'task' AND x.from_id IN (SELECT id::text FROM tree))
			   OR (x.to_type = 'task' AND x.to_id IN (SELECT id::text FROM tree))
			   OR (x.from_type = 'meeting' AND x.from_id IN (SELECT id::text FROM meeting_ids))
			   OR (x.to_type = 'meeting' AND x.to_id IN (SELECT id::text FROM meeting_ids))
		`);
		await tx.execute(sql`
			WITH RECURSIVE tree AS (
				SELECT id FROM tasks WHERE id = ANY(${uuids(taskIds)})
				UNION SELECT child.id FROM tasks child JOIN tree parent ON child.parent_id = parent.id
			), meeting_ids AS (SELECT id FROM meetings WHERE hub_task_id IN (SELECT id FROM tree))
			UPDATE tasks SET meeting_id = NULL
			WHERE id NOT IN (SELECT id FROM tree) AND meeting_id IN (SELECT id::text FROM meeting_ids)
		`);
		await tx.execute(sql`
			WITH RECURSIVE tree AS (
				SELECT id FROM tasks WHERE id = ANY(${uuids(taskIds)})
				UNION SELECT child.id FROM tasks child JOIN tree parent ON child.parent_id = parent.id
			), meeting_ids AS (SELECT id FROM meetings WHERE hub_task_id IN (SELECT id FROM tree))
			UPDATE meetings SET prev_meeting_id = NULL
			WHERE id NOT IN (SELECT id FROM meeting_ids) AND prev_meeting_id IN (SELECT id FROM meeting_ids)
		`);
		// meetings.hub_task_id má ON DELETE CASCADE; sidecar proto zmizí ve stejné
		// DB operaci jako hub. BEFORE DELETE trigger současně odpojí zachované action
		// tasky a navazující porady, takže nevzniknou soft-reference sirotci.
		await tx.execute(sql`DELETE FROM tasks WHERE id = ANY(${uuids(taskIds)})`);
		await tx.insert(auditEvents).values({
			workspaceId,
			actorType: "user",
			actorUserId: session.user.id,
			entity: "task_delete_batch",
			entityId: batch.id,
			action: "delete",
			diff: { rootTaskIds: taskIds, undoExpiresHours: 24 },
			requestId: c.get("requestId") ?? null,
		});
		return { batchId: batch.id, replay: false as const };
	});

	if ("conflict" in result) return c.json({ error: "operation_id_reused" }, 409);
	if ("missing" in result) return c.json({ error: "task_not_found" }, 404);
	if ("forbidden" in result) return c.json({ error: "forbidden" }, 403);
	if ("multipleWorkspaces" in result)
		return c.json({ error: "cross_workspace_batch_not_allowed" }, 422);
	return c.json({ ok: true, batchId: result.batchId, replay: result.replay });
});

taskCommandRoutes.post("/api/tasks/restore", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = restoreSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_task_restore" }, 422);
	const db = getDb();

	const result = await db.transaction(async (tx) => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${parsed.data.batchId}, 0))`);
		const rows = (await tx.execute(sql`
			SELECT id, workspace_id, created_by, snapshot, restored_at, expires_at
			FROM task_undo_batches WHERE id = ${parsed.data.batchId} FOR UPDATE
		`)) as unknown as {
			id: string;
			workspace_id: string;
			created_by: string;
			snapshot: { projectIds?: string[] };
			restored_at: Date | null;
			expires_at: Date;
		}[];
		const batch = rows[0];
		if (!batch) return { missing: true as const };
		if (batch.created_by !== session.user.id) return { forbidden: true as const };
		if (batch.restored_at) return { replay: true as const };
		if (new Date(batch.expires_at).getTime() <= Date.now()) return { expired: true as const };
		const projectIds = Array.isArray(batch.snapshot.projectIds) ? batch.snapshot.projectIds : [];
		const access = (await tx.execute(sql`
			SELECT p.id AS project_id, p.workspace_id, pm.role::text AS project_role,
			       wm.role::text AS workspace_role, w.owner_id, p.id::text AS id
			FROM projects p JOIN workspaces w ON w.id = p.workspace_id
			LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${session.user.id}
			LEFT JOIN memberships wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${session.user.id}
			WHERE p.id = ANY(${uuids(projectIds)})
		`)) as unknown as AccessRow[];
		if (access.length !== projectIds.length || !access.every((row) => canEditTask(row, session.user.id)))
			return { forbidden: true as const };

		// Raw SQL parametr musí být serializovaný JSON string; předání JS objektu přes
		// drizzle `sql` končí v postgres-js jako neplatný binární argument.
		const snapshot = sql`${JSON.stringify(batch.snapshot)}::jsonb`;
		await tx.execute(sql`INSERT INTO tasks SELECT * FROM jsonb_populate_recordset(null::tasks, ${snapshot}->'tasks') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO meetings SELECT * FROM jsonb_populate_recordset(null::meetings, ${snapshot}->'meetings') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO assignments SELECT * FROM jsonb_populate_recordset(null::assignments, ${snapshot}->'assignments') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO comments SELECT * FROM jsonb_populate_recordset(null::comments, ${snapshot}->'comments') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO comment_decisions SELECT * FROM jsonb_populate_recordset(null::comment_decisions, ${snapshot}->'commentDecisions') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO mentions SELECT * FROM jsonb_populate_recordset(null::mentions, ${snapshot}->'mentions') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO attachments SELECT * FROM jsonb_populate_recordset(null::attachments, ${snapshot}->'attachments') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO reminders SELECT * FROM jsonb_populate_recordset(null::reminders, ${snapshot}->'reminders') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO task_activity SELECT * FROM jsonb_populate_recordset(null::task_activity, ${snapshot}->'taskActivity') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO task_dependencies SELECT * FROM jsonb_populate_recordset(null::task_dependencies, ${snapshot}->'taskDependencies') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO task_occurrence_overrides SELECT * FROM jsonb_populate_recordset(null::task_occurrence_overrides, ${snapshot}->'occurrences') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO task_user_colors SELECT * FROM jsonb_populate_recordset(null::task_user_colors, ${snapshot}->'colors') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO chain_steps SELECT * FROM jsonb_populate_recordset(null::chain_steps, ${snapshot}->'chainSteps') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO calendar_links SELECT * FROM jsonb_populate_recordset(null::calendar_links, ${snapshot}->'calendarLinks') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO checklist_items SELECT * FROM jsonb_populate_recordset(null::checklist_items, ${snapshot}->'checklistItems') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO task_labels SELECT * FROM jsonb_populate_recordset(null::task_labels, ${snapshot}->'taskLabels') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`INSERT INTO entity_links SELECT * FROM jsonb_populate_recordset(null::entity_links, ${snapshot}->'entityLinks') ON CONFLICT DO NOTHING`);
		await tx.execute(sql`
			UPDATE tasks t SET meeting_id = x.meeting_id
			FROM jsonb_to_recordset(${snapshot}->'detachedMeetingTasks') AS x(id uuid, meeting_id text)
			WHERE t.id = x.id
		`);
		await tx.execute(sql`
			UPDATE meetings m SET prev_meeting_id = x.prev_meeting_id
			FROM jsonb_to_recordset(${snapshot}->'detachedNextMeetings') AS x(id uuid, prev_meeting_id uuid)
			WHERE m.id = x.id
		`);
		await tx
			.update(taskUndoBatches)
			.set({ restoredAt: new Date() })
			.where(eq(taskUndoBatches.id, batch.id));
		await tx.insert(auditEvents).values({
			workspaceId: batch.workspace_id,
			actorType: "user",
			actorUserId: session.user.id,
			entity: "task_delete_batch",
			entityId: batch.id,
			action: "restore",
			diff: { projectIds },
			requestId: c.get("requestId") ?? null,
		});
		return { replay: false as const };
	});

	if ("missing" in result) return c.json({ error: "undo_batch_not_found" }, 404);
	if ("forbidden" in result) return c.json({ error: "forbidden" }, 403);
	if ("expired" in result) return c.json({ error: "undo_expired" }, 410);
	return c.json({ ok: true, replay: result.replay });
});
