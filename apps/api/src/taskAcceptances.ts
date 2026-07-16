import { and, auditEvents, eq, getDb, sql, taskAcceptances } from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

export const taskAcceptanceRoutes = new Hono<{ Variables: { requestId: string } }>();

const responseSchema = z
	.object({
		expectedUpdatedAt: z.string().datetime({ offset: true }),
		status: z.enum(["accepted", "declined"]),
		note: z.string().trim().max(1000).nullable().optional(),
	})
	.strict();

type AcceptanceAccess = {
	id: string;
	task_id: string;
	project_id: string;
	workspace_id: string;
	assignee_id: string;
	status: "pending" | "accepted" | "declined" | "cancelled";
	note: string | null;
	updated_at: string | Date;
	task_completed_at: string | Date | null;
	assignment_completed_at: string | Date | null;
	required: boolean;
};

class AcceptanceError extends Error {
	constructor(
		readonly code: string,
		readonly statusCode: 403 | 404 | 409,
	) {
		super(code);
	}
}

/**
 * Řešitel přijme nebo odmítne urgentní úkol. Formulář příjmu práce ani jeho
 * odesílatel zde nehrají roli: jde o samostatné rozhodnutí již přiřazené osoby.
 */
taskAcceptanceRoutes.post("/api/task-acceptances/:id/respond", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const id = z.string().uuid().safeParse(c.req.param("id"));
	const parsed = responseSchema.safeParse(await c.req.json().catch(() => null));
	if (!id.success || !parsed.success) return c.json({ error: "invalid_task_acceptance" }, 422);
	const note = parsed.data.note?.trim() || null;

	try {
		const result = await getDb().transaction(async (tx) => {
			const rows = (await tx.execute(sql`
				SELECT acceptance.id, acceptance.task_id, acceptance.project_id,
				       p.workspace_id, acceptance.assignee_id, acceptance.status,
				       acceptance.note, acceptance.updated_at,
				       t.completed_at AS task_completed_at,
				       a.completed_at AS assignment_completed_at,
				       watson_task_requires_acceptance(t.id, acceptance.assignee_id) AS required
				FROM task_acceptances acceptance
				JOIN tasks t ON t.id = acceptance.task_id
				JOIN projects p ON p.id = acceptance.project_id
				JOIN project_members viewer
				  ON viewer.project_id = acceptance.project_id AND viewer.user_id = ${session.user.id}
				LEFT JOIN assignments a
				  ON a.task_id = acceptance.task_id AND a.user_id = acceptance.assignee_id
				WHERE acceptance.id = ${id.data}
				FOR UPDATE OF acceptance
			`)) as unknown as AcceptanceAccess[];
			const current = rows[0];
			if (!current) throw new AcceptanceError("task_acceptance_not_found", 404);
			if (current.assignee_id !== session.user.id)
				throw new AcceptanceError("task_acceptance_forbidden", 403);
			if (!current.required || current.status === "cancelled")
				throw new AcceptanceError("task_acceptance_not_required", 409);
			if (current.task_completed_at || current.assignment_completed_at)
				throw new AcceptanceError("task_acceptance_locked", 409);

			// Ztracená odpověď a přesný retry jsou idempotentní.
			if (current.status === parsed.data.status && current.note === note)
				return { acceptance: current, replayed: true };

			const [updated] = await tx
				.update(taskAcceptances)
				.set({
					status: parsed.data.status,
					note,
					respondedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(taskAcceptances.id, current.id),
						eq(
							taskAcceptances.updatedAt,
							sql`${parsed.data.expectedUpdatedAt}::timestamptz`,
						),
					),
				)
				.returning();
			if (!updated) throw new AcceptanceError("stale_task_acceptance", 409);

			await tx.insert(auditEvents).values({
				workspaceId: current.workspace_id,
				actorUserId: session.user.id,
				entity: "task_acceptances",
				entityId: current.id,
				action: parsed.data.status,
				before: { status: current.status, noteProvided: Boolean(current.note) },
				diff: {
					task_id: current.task_id,
					project_id: current.project_id,
					assignee_id: current.assignee_id,
					status: parsed.data.status,
					noteProvided: Boolean(note),
				},
				requestId: c.get("requestId"),
			});
			return { acceptance: updated, replayed: false };
		});
		return c.json(result);
	} catch (error) {
		if (error instanceof AcceptanceError)
			return c.json({ error: error.code }, error.statusCode);
		throw error;
	}
});
