import { getDb, sql } from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

export const chainCommandRoutes = new Hono<{ Variables: { requestId: string } }>();

const paramsSchema = z.object({ stepId: z.string().uuid() }).strict();
const PROJECT_RANK: Record<string, number> = { commenter: 1, editor: 2, manager: 3 };

chainCommandRoutes.post("/api/chains/steps/:stepId/activate", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = paramsSchema.safeParse({ stepId: c.req.param("stepId") });
	if (!parsed.success) return c.json({ error: "invalid_step_id" }, 400);
	const db = getDb();
	try {
		const result = await db.transaction(async (tx) => {
			const rows = (await tx.execute(sql`
				SELECT cs.id, cs.chain_id, cs.position, cs.gate, cs.step_state,
				       c.project_id, c.workspace_id, pm.role AS project_role,
				       m.role AS workspace_role, w.owner_id
				FROM chain_steps cs
				JOIN chains c ON c.id = cs.chain_id
				JOIN workspaces w ON w.id = c.workspace_id
				LEFT JOIN project_members pm ON pm.project_id = c.project_id AND pm.user_id = ${session.user.id}
				LEFT JOIN memberships m ON m.workspace_id = c.workspace_id AND m.user_id = ${session.user.id}
				WHERE cs.id = ${parsed.data.stepId}
				FOR UPDATE OF cs, c
			`)) as {
				id: string;
				chain_id: string;
				position: number;
				gate: string;
				step_state: string;
				project_id: string;
				workspace_id: string;
				project_role: string | null;
				workspace_role: string | null;
				owner_id: string | null;
			}[];
			const step = rows[0];
			if (!step) return { status: 404 as const, body: { error: "step_not_found" } };
			const canEdit =
				(PROJECT_RANK[step.project_role ?? ""] ?? 0) >= 2 ||
				step.workspace_role === "admin" ||
				step.owner_id === session.user.id;
			if (!canEdit) return { status: 403 as const, body: { error: "forbidden" } };
			if (step.gate !== "manual") {
				return { status: 409 as const, body: { error: "step_is_not_manual" } };
			}
			if (step.step_state === "active") {
				return {
					status: 200 as const,
					body: { ok: true, replay: true, activatedStepIds: [step.id] },
				};
			}
			if (step.step_state !== "dormant") {
				return { status: 409 as const, body: { error: "step_not_dormant" } };
			}
			const blockers = (await tx.execute(sql`
				SELECT prev.id
				FROM chain_steps prev
				LEFT JOIN tasks t ON t.id = prev.task_id
				WHERE prev.chain_id = ${step.chain_id}
				  AND prev.position < ${step.position}
				  AND prev.step_state <> 'skipped'
				  AND t.completed_at IS NULL
				LIMIT 1
			`)) as { id: string }[];
			if (blockers.length > 0) {
				return { status: 409 as const, body: { error: "previous_steps_not_closed" } };
			}

			const following = (await tx.execute(sql`
				SELECT id, gate, step_state
				FROM chain_steps
				WHERE chain_id = ${step.chain_id} AND position >= ${step.position}
				ORDER BY position, id
				FOR UPDATE
			`)) as { id: string; gate: string; step_state: string }[];
			const activatedStepIds: string[] = [];
			for (let index = 0; index < following.length; index++) {
				const candidate = following[index];
				if (!candidate) continue;
				if (index > 0 && candidate.gate !== "with_previous") break;
				if (candidate.step_state === "done" || candidate.step_state === "skipped") continue;
				activatedStepIds.push(candidate.id);
			}
			await tx.execute(sql`SELECT set_config('watson.allow_manual_chain_activation', 'on', true)`);
			await tx.execute(sql`
				UPDATE chain_steps
				SET step_state = 'active', activated_at = now()
				WHERE id = ANY(${sql`ARRAY[${sql.join(activatedStepIds.map((id) => sql`${id}`), sql`, `)}]::uuid[]`})
			`);
			await tx.execute(sql`
				INSERT INTO audit_events
					(workspace_id, actor_type, actor_user_id, entity, entity_id, action, diff, request_id)
				VALUES
					(${step.workspace_id}, 'user', ${session.user.id}, 'chain_step', ${step.id},
					 'manual_activate', ${JSON.stringify({ chainId: step.chain_id, activatedStepIds })}::jsonb,
					 ${c.get("requestId")})
			`);
			return {
				status: 200 as const,
				body: { ok: true, replay: false, activatedStepIds },
			};
		});
		return c.json(result.body, result.status);
	} catch {
		return c.json({ error: "manual_activation_failed" }, 500);
	}
});
