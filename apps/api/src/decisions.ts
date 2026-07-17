/** F6 — kanonický Decision Log: ruční rozhodnutí, revize a bezpečný read model. */
import { createHash } from "node:crypto";
import {
	and,
	auditEvents,
	commentDecisions,
	decisionCommandReceipts,
	decisions,
	decisionTaskLinks,
	desc,
	eq,
	getDb,
	inArray,
	projectMembers,
	projects,
	sql,
	tasks,
	users,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

export const decisionRoutes = new Hono<{ Variables: { requestId: string } }>();

const PROJECT_ROLE_RANK: Record<string, number> = { commenter: 1, editor: 2, manager: 3 };
const EDITOR_RANK = 2;
const uuid = z.string().uuid();
const nullableDate = z.string().datetime({ offset: true }).nullable();
const relatedTasks = z.array(uuid).max(30).default([]);
const createSchema = z
	.object({
		id: uuid,
		operationId: uuid,
		projectId: uuid,
		title: z.string().trim().min(1).max(2_000),
		rationale: z.string().trim().max(10_000).nullable().optional(),
		ownerUserId: uuid.nullable().optional(),
		decidedAt: z.string().datetime({ offset: true }).optional(),
		effectiveAt: nullableDate.optional(),
		reviewAt: nullableDate.optional(),
		relatedTaskIds: relatedTasks.optional(),
		supersedesId: uuid.optional(),
	})
	.strict();
const reviewSchema = z
	.object({
		operationId: uuid,
		expectedVersion: z.number().int().positive(),
		rationale: z.string().trim().max(10_000).nullable().optional(),
		ownerUserId: uuid.nullable().optional(),
		effectiveAt: nullableDate.optional(),
		reviewAt: nullableDate.optional(),
		status: z.enum(["active", "withdrawn"]).optional(),
		relatedTaskIds: z.array(uuid).max(30).optional(),
	})
	.strict()
	.refine(
		(value) =>
			value.rationale !== undefined ||
			value.ownerUserId !== undefined ||
			value.effectiveAt !== undefined ||
			value.reviewAt !== undefined ||
			value.status !== undefined ||
			value.relatedTaskIds !== undefined,
		"empty_review",
	);
const listSchema = z.object({
	workspaceId: uuid,
	projectId: uuid.optional(),
	status: z.enum(["active", "superseded", "withdrawn"]).optional(),
	source: z.enum(["manual", "comment", "meeting"]).optional(),
	q: z.string().trim().max(200).optional(),
	cursor: z.string().trim().max(300).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
});

const cursorSchema = z.object({ decidedAt: z.string().datetime(), id: uuid }).strict();

function decodeCursor(value: string | undefined) {
	if (!value) return null;
	try {
		return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
	} catch {
		return undefined;
	}
}

function encodeCursor(row: typeof decisions.$inferSelect) {
	return Buffer.from(
		JSON.stringify({ decidedAt: row.decidedAt.toISOString(), id: row.id }),
		"utf8",
	).toString("base64url");
}

class DecisionError extends Error {
	constructor(
		readonly code: string,
		readonly status: 403 | 404 | 409 | 422 | 503,
	) {
		super(code);
	}
}

function hash(value: unknown) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function linkedTasks(decisionIds: string[]) {
	if (decisionIds.length === 0) return new Map<string, Array<{ id: string; name: string }>>();
	const rows = await getDb()
		.select({ decisionId: decisionTaskLinks.decisionId, id: tasks.id, name: tasks.name })
		.from(decisionTaskLinks)
		.innerJoin(tasks, eq(tasks.id, decisionTaskLinks.taskId))
		.where(inArray(decisionTaskLinks.decisionId, decisionIds));
	const result = new Map<string, Array<{ id: string; name: string }>>();
	for (const row of rows) {
		const current = result.get(row.decisionId) ?? [];
		current.push({ id: row.id, name: row.name });
		result.set(row.decisionId, current);
	}
	return result;
}

async function sourceDetails(rows: Array<typeof decisions.$inferSelect>) {
	const commentSourceIds = rows
		.filter((row) => row.sourceType === "comment" && row.sourceObjectId)
		.map((row) => row.sourceObjectId as string);
	const comments = commentSourceIds.length
		? await getDb()
				.select({ id: commentDecisions.id, taskId: commentDecisions.taskId })
				.from(commentDecisions)
				.where(inArray(commentDecisions.id, commentSourceIds))
		: [];
	return new Map(comments.map((row) => [row.id, row.taskId]));
}

async function publicRows(
	rows: Array<{
		decision: typeof decisions.$inferSelect;
		projectName: string;
		sourceExists: boolean;
	}>,
) {
	const taskMap = await linkedTasks(rows.map((row) => row.decision.id));
	const commentSources = await sourceDetails(rows.map((row) => row.decision));
	const userIds = [
		...new Set(
			rows.flatMap(({ decision }) =>
				[decision.ownerUserId, decision.createdBy].filter((id): id is string => Boolean(id)),
			),
		),
	];
	const userRows = userIds.length
		? await getDb()
				.select({ id: users.id, name: users.name })
				.from(users)
				.where(inArray(users.id, userIds))
		: [];
	const userNames = new Map(userRows.map((row) => [row.id, row.name]));
	return rows.map(({ decision, projectName, sourceExists }) => ({
		id: decision.id,
		workspaceId: decision.workspaceId,
		projectId: decision.projectId,
		projectName,
		sourceType: decision.sourceType,
		sourceObjectId: decision.sourceObjectId,
		sourceExists,
		sourceTaskId:
			decision.sourceType === "comment" && decision.sourceObjectId
				? (commentSources.get(decision.sourceObjectId) ?? taskMap.get(decision.id)?.[0]?.id ?? null)
				: null,
		title: decision.title,
		rationale: decision.rationale,
		ownerUserId: decision.ownerUserId,
		ownerName: decision.ownerUserId ? (userNames.get(decision.ownerUserId) ?? null) : null,
		decidedAt: decision.decidedAt.toISOString(),
		effectiveAt: decision.effectiveAt?.toISOString() ?? null,
		reviewAt: decision.reviewAt?.toISOString() ?? null,
		status: decision.status,
		supersedesId: decision.supersedesId,
		createdBy: decision.createdBy,
		creatorName: decision.createdBy ? (userNames.get(decision.createdBy) ?? null) : null,
		version: decision.version,
		createdAt: decision.createdAt.toISOString(),
		updatedAt: decision.updatedAt.toISOString(),
		relatedTasks: taskMap.get(decision.id) ?? [],
	}));
}

decisionRoutes.get("/api/decisions", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const query = listSchema.safeParse(c.req.query());
	if (!query.success) return c.json({ error: "invalid_decision_query" }, 422);
	const cursor = decodeCursor(query.data.cursor);
	if (cursor === undefined) return c.json({ error: "invalid_decision_cursor" }, 422);
	const filters = [
		eq(decisions.workspaceId, query.data.workspaceId),
		eq(projectMembers.userId, session.user.id),
	];
	if (query.data.projectId) filters.push(eq(decisions.projectId, query.data.projectId));
	if (query.data.status) filters.push(eq(decisions.status, query.data.status));
	if (query.data.source) filters.push(eq(decisions.sourceType, query.data.source));
	if (query.data.q) {
		const pattern = `%${query.data.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
		filters.push(
			sql`(${decisions.title} ILIKE ${pattern} ESCAPE '\\' OR COALESCE(${decisions.rationale}, '') ILIKE ${pattern} ESCAPE '\\')`,
		);
	}
	if (cursor) {
		filters.push(
			sql`(${decisions.decidedAt}, ${decisions.id}) < (${cursor.decidedAt}::timestamptz, ${cursor.id}::uuid)`,
		);
	}
	const rows = await getDb()
		.select({
			decision: decisions,
			projectName: projects.name,
			sourceExists: sql<boolean>`CASE
				WHEN ${decisions.sourceType} = 'manual' THEN true
				WHEN ${decisions.sourceType} = 'comment' THEN EXISTS (
					SELECT 1 FROM comment_decisions cd WHERE cd.id = ${decisions.sourceObjectId}
				)
				WHEN ${decisions.sourceType} = 'meeting' THEN EXISTS (
					SELECT 1 FROM meetings m WHERE m.id = ${decisions.sourceObjectId}
				)
				ELSE false END`,
		})
		.from(decisions)
		.innerJoin(projects, eq(projects.id, decisions.projectId))
		.innerJoin(
			projectMembers,
			and(
				eq(projectMembers.projectId, decisions.projectId),
				eq(projectMembers.userId, session.user.id),
			),
		)
		.where(and(...filters))
		.orderBy(desc(decisions.decidedAt), desc(decisions.id))
		.limit(query.data.limit + 1);
	const hasMore = rows.length > query.data.limit;
	const page = hasMore ? rows.slice(0, query.data.limit) : rows;
	const last = page[page.length - 1];
	return c.json({
		decisions: await publicRows(page),
		nextCursor: hasMore && last ? encodeCursor(last.decision) : null,
	});
});

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function projectAccess(tx: Tx, projectId: string, userId: string) {
	return (
		await tx
			.select({ workspaceId: projects.workspaceId, role: projectMembers.role })
			.from(projects)
			.innerJoin(
				projectMembers,
				and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)),
			)
			.where(eq(projects.id, projectId))
			.limit(1)
	)[0];
}

async function validateReferences(
	tx: Tx,
	projectId: string,
	ownerUserId: string | null | undefined,
	taskIds: string[],
) {
	if (
		ownerUserId &&
		(
			await tx
				.select({ id: projectMembers.id })
				.from(projectMembers)
				.where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, ownerUserId)))
				.limit(1)
		).length === 0
	)
		throw new DecisionError("decision_owner_not_project_member", 422);
	if (taskIds.length > 0) {
		const found = await tx
			.select({ id: tasks.id })
			.from(tasks)
			.where(and(eq(tasks.projectId, projectId), inArray(tasks.id, taskIds)));
		if (found.length !== taskIds.length)
			throw new DecisionError("decision_task_scope_mismatch", 422);
	}
}

decisionRoutes.post("/api/decisions", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const body = createSchema.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: "invalid_decision" }, 422);
	const taskIds = [...new Set(body.data.relatedTaskIds ?? [])];
	const requestHash = hash({ action: "create", ...body.data, relatedTaskIds: taskIds });
	try {
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${session.user.id}:${body.data.operationId}`}, 0))`,
			);
			const replay = (
				await tx
					.select()
					.from(decisionCommandReceipts)
					.where(
						and(
							eq(decisionCommandReceipts.actorUserId, session.user.id),
							eq(decisionCommandReceipts.operationId, body.data.operationId),
						),
					)
					.limit(1)
			)[0];
			if (replay) {
				if (replay.requestHash !== requestHash || replay.action !== "create") {
					throw new DecisionError("operation_id_reused", 409);
				}
				return { id: String(replay.response.id), replayed: true };
			}
			const access = await projectAccess(tx, body.data.projectId, session.user.id);
			if (!access || (PROJECT_ROLE_RANK[access.role] ?? 0) < EDITOR_RANK) {
				throw new DecisionError("decision_project_not_found", 404);
			}
			await validateReferences(tx, body.data.projectId, body.data.ownerUserId, taskIds);
			let previous: Pick<typeof decisions.$inferSelect, "id" | "status" | "version"> | undefined;
			if (body.data.supersedesId) {
				previous = (
					(await tx.execute(sql`
						SELECT id, status, version FROM decisions
						WHERE id = ${body.data.supersedesId} AND project_id = ${body.data.projectId}
						LIMIT 1 FOR UPDATE
					`)) as unknown as Array<Pick<typeof decisions.$inferSelect, "id" | "status" | "version">>
				)[0];
				if (previous?.status !== "active") {
					throw new DecisionError("decision_supersedes_invalid", 409);
				}
			}
			const inserted = await tx
				.insert(decisions)
				.values({
					id: body.data.id,
					workspaceId: access.workspaceId,
					projectId: body.data.projectId,
					sourceType: "manual",
					sourceObjectId: null,
					sourceKey: "manual",
					title: body.data.title,
					rationale: body.data.rationale ?? null,
					ownerUserId: body.data.ownerUserId ?? null,
					decidedAt: body.data.decidedAt ? new Date(body.data.decidedAt) : new Date(),
					effectiveAt: body.data.effectiveAt ? new Date(body.data.effectiveAt) : null,
					reviewAt: body.data.reviewAt ? new Date(body.data.reviewAt) : null,
					supersedesId: body.data.supersedesId ?? null,
					createdBy: session.user.id,
				})
				.returning({ id: decisions.id });
			if (!inserted[0]) throw new DecisionError("decision_conflict", 409);
			if (taskIds.length > 0) {
				await tx.insert(decisionTaskLinks).values(
					taskIds.map((taskId) => ({
						decisionId: body.data.id,
						taskId,
						projectId: body.data.projectId,
					})),
				);
			}
			if (previous) {
				const superseded = await tx
					.update(decisions)
					.set({ status: "superseded", version: sql`${decisions.version} + 1` })
					.where(and(eq(decisions.id, previous.id), eq(decisions.version, previous.version)))
					.returning({ id: decisions.id });
				if (!superseded[0]) throw new DecisionError("decision_supersedes_invalid", 409);
			}
			await tx.insert(auditEvents).values({
				workspaceId: access.workspaceId,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "decisions",
				entityId: body.data.id,
				action: previous ? "supersede" : "create",
				diff: {
					projectId: body.data.projectId,
					ownerUserId: body.data.ownerUserId ?? null,
					relatedTaskCount: taskIds.length,
					supersedesId: previous?.id ?? null,
					hasRationale: Boolean(body.data.rationale),
				},
				requestId: c.get("requestId") ?? null,
			});
			const response = { id: body.data.id, version: 1, status: "active" };
			await tx.insert(decisionCommandReceipts).values({
				workspaceId: access.workspaceId,
				actorUserId: session.user.id,
				operationId: body.data.operationId,
				requestHash,
				action: "create",
				response,
			});
			return { id: body.data.id, replayed: false };
		});
		return c.json(result, result.replayed ? 200 : 201);
	} catch (error) {
		if (error instanceof DecisionError) return c.json({ error: error.code }, error.status);
		const code =
			(error as { code?: string; cause?: { code?: string } })?.code ??
			(error as { cause?: { code?: string } })?.cause?.code;
		return c.json(
			{ error: code === "23505" ? "decision_conflict" : "decision_unavailable" },
			code === "23505" ? 409 : 503,
		);
	}
});

decisionRoutes.patch("/api/decisions/:id", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const id = uuid.safeParse(c.req.param("id"));
	const body = reviewSchema.safeParse(await c.req.json().catch(() => null));
	if (!id.success || !body.success) return c.json({ error: "invalid_decision_review" }, 422);
	const taskIds = body.data.relatedTaskIds ? [...new Set(body.data.relatedTaskIds)] : undefined;
	const requestHash = hash({
		action: "review",
		id: id.data,
		...body.data,
		relatedTaskIds: taskIds,
	});
	try {
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${session.user.id}:${body.data.operationId}`}, 0))`,
			);
			const replay = (
				await tx
					.select()
					.from(decisionCommandReceipts)
					.where(
						and(
							eq(decisionCommandReceipts.actorUserId, session.user.id),
							eq(decisionCommandReceipts.operationId, body.data.operationId),
						),
					)
					.limit(1)
			)[0];
			if (replay) {
				if (replay.requestHash !== requestHash || replay.action !== "review") {
					throw new DecisionError("operation_id_reused", 409);
				}
				return { id: id.data, version: Number(replay.response.version), replayed: true };
			}
			const row = (await tx.select().from(decisions).where(eq(decisions.id, id.data)).limit(1))[0];
			if (!row) throw new DecisionError("decision_not_found", 404);
			const access = await projectAccess(tx, row.projectId, session.user.id);
			if (!access || (PROJECT_ROLE_RANK[access.role] ?? 0) < EDITOR_RANK) {
				throw new DecisionError("decision_not_found", 404);
			}
			if (row.status !== "active") throw new DecisionError("decision_terminal", 409);
			if (row.version !== body.data.expectedVersion) throw new DecisionError("stale_version", 409);
			await validateReferences(tx, row.projectId, body.data.ownerUserId, taskIds ?? []);
			const updated = await tx
				.update(decisions)
				.set({
					rationale: body.data.rationale,
					ownerUserId: body.data.ownerUserId,
					effectiveAt:
						body.data.effectiveAt === undefined
							? undefined
							: body.data.effectiveAt
								? new Date(body.data.effectiveAt)
								: null,
					reviewAt:
						body.data.reviewAt === undefined
							? undefined
							: body.data.reviewAt
								? new Date(body.data.reviewAt)
								: null,
					status: body.data.status,
					version: sql`${decisions.version} + 1`,
				})
				.where(and(eq(decisions.id, id.data), eq(decisions.version, body.data.expectedVersion)))
				.returning({ id: decisions.id, version: decisions.version, status: decisions.status });
			if (!updated[0]) throw new DecisionError("stale_version", 409);
			if (taskIds) {
				await tx.delete(decisionTaskLinks).where(eq(decisionTaskLinks.decisionId, id.data));
				if (taskIds.length > 0) {
					await tx
						.insert(decisionTaskLinks)
						.values(
							taskIds.map((taskId) => ({ decisionId: id.data, taskId, projectId: row.projectId })),
						);
				}
			}
			await tx.insert(auditEvents).values({
				workspaceId: row.workspaceId,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "decisions",
				entityId: row.id,
				action: body.data.status === "withdrawn" ? "withdraw" : "review",
				diff: {
					previousVersion: row.version,
					ownerUserId: body.data.ownerUserId,
					effectiveAt: body.data.effectiveAt,
					reviewAt: body.data.reviewAt,
					status: body.data.status,
					relatedTaskCount: taskIds?.length,
					rationaleChanged: body.data.rationale !== undefined,
				},
				requestId: c.get("requestId") ?? null,
			});
			await tx.insert(decisionCommandReceipts).values({
				workspaceId: row.workspaceId,
				actorUserId: session.user.id,
				operationId: body.data.operationId,
				requestHash,
				action: "review",
				response: updated[0],
			});
			return { ...updated[0], replayed: false };
		});
		return c.json(result);
	} catch (error) {
		if (error instanceof DecisionError) return c.json({ error: error.code }, error.status);
		return c.json({ error: "decision_unavailable" }, 503);
	}
});
