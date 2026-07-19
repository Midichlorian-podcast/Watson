import {
	and,
	auditEvents,
	eq,
	getDb,
	POLL_RESPONSE_TYPES,
	sql,
	taskPollResponses,
	taskPolls,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

const uuid = z.string().uuid();
const responseType = z.enum(POLL_RESPONSE_TYPES);
const optionLabels = z
	.array(z.string().trim().min(1).max(120))
	.min(2)
	.max(20)
	.refine(
		(labels) => new Set(labels.map((label) => label.toLocaleLowerCase())).size === labels.length,
		"duplicate_options",
	);
const createSchema = z
	.object({
		id: uuid,
		question: z.string().trim().min(1).max(240),
		responseType,
		options: optionLabels.optional(),
	})
	.strict()
	.superRefine((body, context) => {
		const choice = body.responseType === "single_choice" || body.responseType === "multiple_choice";
		if (choice && !body.options)
			context.addIssue({ code: "custom", path: ["options"], message: "options_required" });
		if (!choice && body.options !== undefined)
			context.addIssue({ code: "custom", path: ["options"], message: "options_not_allowed" });
	});
const updateSchema = z
	.object({
		question: z.string().trim().min(1).max(240).optional(),
		responseType: responseType.optional(),
		options: optionLabels.optional(),
	})
	.strict()
	.refine((body) => Object.keys(body).length > 0, "nothing_to_update");
const responseSchema = z.object({ value: z.unknown() }).strict();

const PROJECT_ROLE_RANK: Record<string, number> = { commenter: 1, editor: 2, manager: 3 };
const MAX_POLLS_PER_TASK = 20;

type Access = {
	task_id: string;
	project_id: string;
	workspace_id: string;
	role: string;
	workspace_role: string;
};
type PollRow = Access & {
	id: string;
	question: string;
	response_type: (typeof POLL_RESPONSE_TYPES)[number];
	options: { id: string; label: string }[];
	closed_at: string | Date | null;
	created_by: string | null;
};

class PollError extends Error {
	constructor(
		readonly code: string,
		readonly status: 403 | 404 | 409 | 422,
	) {
		super(code);
	}
}

function errorChainValue(error: unknown, key: "code" | "message"): string | null {
	let current: unknown = error;
	for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
		const value = current as { code?: unknown; message?: unknown; cause?: unknown };
		if (typeof value[key] === "string") return value[key] as string;
		current = value.cause;
	}
	return null;
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function optionsFromLabels(
	labels: string[],
	existing: { id: string; label: string }[] = [],
): { id: string; label: string }[] {
	const current = new Map(
		existing.map((option) => [option.label.trim().toLocaleLowerCase(), option.id] as const),
	);
	return labels.map((label) => ({
		id: current.get(label.toLocaleLowerCase()) ?? crypto.randomUUID(),
		label,
	}));
}

async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
	try {
		return schema.parse(await request.json());
	} catch {
		return null;
	}
}

function requireWritable(access: Access) {
	if (access.workspace_role === "guest") throw new PollError("forbidden", 403);
}

function requireEditor(access: Access) {
	requireWritable(access);
	if ((PROJECT_ROLE_RANK[access.role] ?? 0) < 2) throw new PollError("forbidden", 403);
}

async function taskAccess(
	tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
	taskId: string,
	userId: string,
): Promise<Access> {
	const rows = (await tx.execute(sql`
		SELECT t.id AS task_id, t.project_id, p.workspace_id, pm.role::text AS role,
		       CASE WHEN w.owner_id = ${userId} THEN 'owner'::text ELSE m.role::text END AS workspace_role
		FROM tasks t
		JOIN projects p ON p.id = t.project_id
		JOIN workspaces w ON w.id = p.workspace_id
		JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ${userId}
		LEFT JOIN memberships m ON m.workspace_id = p.workspace_id AND m.user_id = ${userId}
		WHERE t.id = ${taskId}
		  AND (w.owner_id = ${userId} OR m.user_id IS NOT NULL)
		LIMIT 1
	`)) as unknown as Access[];
	if (!rows[0]) throw new PollError("not_found", 404);
	return rows[0];
}

async function pollAccess(
	tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
	pollId: string,
	userId: string,
): Promise<PollRow> {
	const rows = (await tx.execute(sql`
		SELECT poll.id, poll.task_id, poll.project_id, poll.question, poll.response_type,
		       poll.options, poll.closed_at, poll.created_by, p.workspace_id,
		       pm.role::text AS role,
		       CASE WHEN w.owner_id = ${userId} THEN 'owner'::text ELSE m.role::text END AS workspace_role
		FROM task_polls poll
		JOIN projects p ON p.id = poll.project_id
		JOIN workspaces w ON w.id = p.workspace_id
		JOIN project_members pm ON pm.project_id = poll.project_id AND pm.user_id = ${userId}
		LEFT JOIN memberships m ON m.workspace_id = p.workspace_id AND m.user_id = ${userId}
		WHERE poll.id = ${pollId}
		  AND (w.owner_id = ${userId} OR m.user_id IS NOT NULL)
		LIMIT 1
	`)) as unknown as PollRow[];
	if (!rows[0]) throw new PollError("poll_not_found", 404);
	return rows[0];
}

function normalizedResponse(poll: PollRow, value: unknown): unknown {
	switch (poll.response_type) {
		case "single_choice":
			if (typeof value !== "string" || !poll.options.some((option) => option.id === value))
				throw new PollError("poll_response_invalid", 422);
			return value;
		case "multiple_choice": {
			if (
				!Array.isArray(value) ||
				value.length < 1 ||
				value.length > 20 ||
				value.some(
					(entry) =>
						typeof entry !== "string" || !poll.options.some((option) => option.id === entry),
				) ||
				new Set(value).size !== value.length
			)
				throw new PollError("poll_response_invalid", 422);
			return value;
		}
		case "text":
			if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > 1000)
				throw new PollError("poll_response_invalid", 422);
			return value.trim();
		case "number":
			if (
				typeof value !== "number" ||
				!Number.isFinite(value) ||
				Math.abs(value) > 1_000_000_000_000_000
			)
				throw new PollError("poll_response_invalid", 422);
			return value;
		case "date": {
			if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
				throw new PollError("poll_response_invalid", 422);
			const date = new Date(`${value}T00:00:00Z`);
			if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
				throw new PollError("poll_response_invalid", 422);
			return value;
		}
	}
}

function pollSqlError(error: unknown): PollError | null {
	if (error instanceof PollError) return error;
	const state = errorChainValue(error, "code");
	const message = errorChainValue(error, "message") ?? "";
	if (state === "23514") {
		if (message.includes("poll_closed")) return new PollError("poll_closed", 409);
		if (message.includes("poll_locked_after_response"))
			return new PollError("poll_locked_after_response", 409);
		return new PollError("poll_invalid", 422);
	}
	if (state === "23505") return new PollError("poll_conflict", 409);
	return null;
}

export const pollRoutes = new Hono<{ Variables: { requestId: string } }>();

pollRoutes.post("/api/tasks/:taskId/polls", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const taskId = c.req.param("taskId");
	const body = await parseBody(c.req.raw, createSchema);
	if (!uuid.safeParse(taskId).success || !body) return c.json({ error: "poll_invalid" }, 422);
	try {
		const result = await getDb().transaction(async (tx) => {
			const access = await taskAccess(tx, taskId, session.user.id);
			requireEditor(access);
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`task-polls:${taskId}`}, 0))`,
			);
			const existing = (await tx.select().from(taskPolls).where(eq(taskPolls.id, body.id)))[0];
			const options =
				body.responseType === "single_choice" || body.responseType === "multiple_choice"
					? optionsFromLabels(body.options ?? [])
					: [];
			if (existing) {
				const same =
					existing.taskId === taskId &&
					existing.projectId === access.project_id &&
					existing.question === body.question &&
					existing.responseType === body.responseType &&
					canonical(existing.options.map((option) => option.label)) ===
						canonical(body.options ?? []);
				if (!same) throw new PollError("poll_id_conflict", 409);
				return { poll: existing, replayed: true };
			}
			const countRows = (await tx.execute(sql`
				SELECT count(*)::int AS count FROM task_polls WHERE task_id = ${taskId}
			`)) as unknown as { count: number }[];
			if ((countRows[0]?.count ?? 0) >= MAX_POLLS_PER_TASK)
				throw new PollError("poll_limit", 409);
			const [poll] = await tx
				.insert(taskPolls)
				.values({
					id: body.id,
					taskId,
					projectId: access.project_id,
					question: body.question,
					responseType: body.responseType,
					options,
					createdBy: session.user.id,
				})
				.returning();
			if (!poll) throw new PollError("poll_create_failed", 409);
			await tx.insert(auditEvents).values({
				workspaceId: access.workspace_id,
				actorUserId: session.user.id,
				entity: "task_polls",
				entityId: poll.id,
				action: "create",
				diff: {
					task_id: taskId,
					project_id: access.project_id,
					question: poll.question,
					response_type: poll.responseType,
					options: poll.options,
				},
				requestId: c.get("requestId"),
			});
			return { poll, replayed: false };
		});
		return c.json(result, result.replayed ? 200 : 201);
	} catch (error) {
		const mapped = pollSqlError(error);
		if (mapped) return c.json({ error: mapped.code }, mapped.status);
		throw error;
	}
});

pollRoutes.patch("/api/polls/:pollId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const pollId = c.req.param("pollId");
	const body = await parseBody(c.req.raw, updateSchema);
	if (!uuid.safeParse(pollId).success || !body) return c.json({ error: "poll_invalid" }, 422);
	try {
		const poll = await getDb().transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`poll:${pollId}`}, 0))`,
			);
			const current = await pollAccess(tx, pollId, session.user.id);
			requireEditor(current);
			const countRows = (await tx.execute(sql`
				SELECT count(*)::int AS count FROM task_poll_responses WHERE poll_id = ${pollId}
			`)) as unknown as { count: number }[];
			if ((countRows[0]?.count ?? 0) > 0) throw new PollError("poll_locked_after_response", 409);
			const nextType = body.responseType ?? current.response_type;
			const choice = nextType === "single_choice" || nextType === "multiple_choice";
			if (choice && body.options === undefined && current.options.length < 2)
				throw new PollError("poll_options_required", 422);
			if (!choice && body.options !== undefined) throw new PollError("poll_options_not_allowed", 422);
			const nextOptions = choice
				? body.options
					? optionsFromLabels(body.options, current.options)
					: current.options
				: [];
			const [updated] = await tx
				.update(taskPolls)
				.set({
					question: body.question ?? current.question,
					responseType: nextType,
					options: nextOptions,
					updatedAt: new Date(),
				})
				.where(eq(taskPolls.id, pollId))
				.returning();
			if (!updated) throw new PollError("poll_not_found", 404);
			await tx.insert(auditEvents).values({
				workspaceId: current.workspace_id,
				actorUserId: session.user.id,
				entity: "task_polls",
				entityId: pollId,
				action: "update",
				before: {
					task_id: current.task_id,
					question: current.question,
					response_type: current.response_type,
					options: current.options,
				},
				diff: {
					task_id: current.task_id,
					question: updated.question,
					response_type: updated.responseType,
					options: updated.options,
				},
				requestId: c.get("requestId"),
			});
			return updated;
		});
		return c.json({ poll });
	} catch (error) {
		const mapped = pollSqlError(error);
		if (mapped) return c.json({ error: mapped.code }, mapped.status);
		throw error;
	}
});

for (const [path, close] of [
	["close", true],
	["reopen", false],
] as const) {
	pollRoutes.post(`/api/polls/:pollId/${path}`, async (c) => {
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		if (!session) return c.json({ error: "unauthorized" }, 401);
		const pollId = c.req.param("pollId");
		if (!uuid.safeParse(pollId).success) return c.json({ error: "poll_invalid" }, 422);
		try {
			const result = await getDb().transaction(async (tx) => {
				await tx.execute(
					sql`SELECT pg_advisory_xact_lock(hashtextextended(${`poll:${pollId}`}, 0))`,
				);
				const current = await pollAccess(tx, pollId, session.user.id);
				requireEditor(current);
				if (Boolean(current.closed_at) === close) return { unchanged: true };
				const closedAt = close ? new Date() : null;
				await tx
					.update(taskPolls)
					.set({ closedAt, updatedAt: new Date() })
					.where(eq(taskPolls.id, pollId));
				await tx.insert(auditEvents).values({
					workspaceId: current.workspace_id,
					actorUserId: session.user.id,
					entity: "task_polls",
					entityId: pollId,
					action: close ? "close" : "reopen",
					before: {
						task_id: current.task_id,
						question: current.question,
						closed_at: current.closed_at,
					},
					diff: { task_id: current.task_id, question: current.question, closed_at: closedAt },
					requestId: c.get("requestId"),
				});
				return { unchanged: false };
			});
			return c.json({ ok: true, ...result });
		} catch (error) {
			const mapped = pollSqlError(error);
			if (mapped) return c.json({ error: mapped.code }, mapped.status);
			throw error;
		}
	});
}

pollRoutes.put("/api/polls/:pollId/response", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const pollId = c.req.param("pollId");
	const body = await parseBody(c.req.raw, responseSchema);
	if (!uuid.safeParse(pollId).success || !body)
		return c.json({ error: "poll_response_invalid" }, 422);
	try {
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`poll:${pollId}`}, 0))`,
			);
			const poll = await pollAccess(tx, pollId, session.user.id);
			requireWritable(poll);
			if (poll.closed_at) throw new PollError("poll_closed", 409);
			const value = normalizedResponse(poll, body.value);
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`poll-response:${pollId}:${session.user.id}`}, 0))`,
			);
			const current = (
				await tx
					.select()
					.from(taskPollResponses)
					.where(
						and(
							eq(taskPollResponses.pollId, pollId),
							eq(taskPollResponses.respondentId, session.user.id),
						),
					)
			)[0];
			if (current && canonical(current.value) === canonical(value))
				return { response: current, unchanged: true };
			const responseId = current?.id ?? crypto.randomUUID();
			const [response] = current
				? await tx
						.update(taskPollResponses)
						.set({ value, updatedAt: new Date() })
						.where(eq(taskPollResponses.id, current.id))
						.returning()
				: await tx
						.insert(taskPollResponses)
						.values({
							id: responseId,
							pollId,
							taskId: poll.task_id,
							projectId: poll.project_id,
							respondentId: session.user.id,
							value,
						})
						.returning();
			if (!response) throw new PollError("poll_response_failed", 409);
			await tx.insert(auditEvents).values({
				workspaceId: poll.workspace_id,
				actorUserId: session.user.id,
				entity: "task_poll_responses",
				entityId: responseId,
				action: current ? "update" : "create",
				before: current
					? {
							task_id: poll.task_id,
							poll_id: pollId,
							question: poll.question,
							response_type: poll.response_type,
							respondent_id: session.user.id,
						}
					: null,
				diff: {
					task_id: poll.task_id,
					project_id: poll.project_id,
					poll_id: pollId,
					question: poll.question,
					response_type: poll.response_type,
					respondent_id: session.user.id,
				},
				requestId: c.get("requestId"),
			});
			return { response, unchanged: false };
		});
		return c.json({ ok: true, ...result });
	} catch (error) {
		const mapped = pollSqlError(error);
		if (mapped) return c.json({ error: mapped.code }, mapped.status);
		throw error;
	}
});

pollRoutes.delete("/api/polls/:pollId/response", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const pollId = c.req.param("pollId");
	if (!uuid.safeParse(pollId).success) return c.json({ error: "poll_response_invalid" }, 422);
	try {
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`poll:${pollId}`}, 0))`,
			);
			const poll = await pollAccess(tx, pollId, session.user.id);
			requireWritable(poll);
			if (poll.closed_at) throw new PollError("poll_closed", 409);
			const current = (
				await tx
					.select()
					.from(taskPollResponses)
					.where(
						and(
							eq(taskPollResponses.pollId, pollId),
							eq(taskPollResponses.respondentId, session.user.id),
						),
					)
			)[0];
			if (!current) return { unchanged: true };
			await tx.delete(taskPollResponses).where(eq(taskPollResponses.id, current.id));
			await tx.insert(auditEvents).values({
				workspaceId: poll.workspace_id,
				actorUserId: session.user.id,
				entity: "task_poll_responses",
				entityId: current.id,
				action: "delete",
				before: {
					task_id: poll.task_id,
					project_id: poll.project_id,
					poll_id: pollId,
					question: poll.question,
					response_type: poll.response_type,
					respondent_id: session.user.id,
				},
				requestId: c.get("requestId"),
			});
			return { unchanged: false };
		});
		return c.json({ ok: true, ...result });
	} catch (error) {
		const mapped = pollSqlError(error);
		if (mapped) return c.json({ error: mapped.code }, mapped.status);
		throw error;
	}
});

pollRoutes.delete("/api/polls/:pollId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const pollId = c.req.param("pollId");
	const confirm = c.req.query("confirm")?.trim();
	if (!uuid.safeParse(pollId).success || !confirm) return c.json({ error: "poll_invalid" }, 422);
	try {
		const removed = await getDb().transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`poll:${pollId}`}, 0))`,
			);
			const poll = await pollAccess(tx, pollId, session.user.id);
			requireEditor(poll);
			if (poll.question !== confirm) throw new PollError("poll_confirmation_mismatch", 409);
			const countRows = (await tx.execute(sql`
				SELECT count(*)::int AS count FROM task_poll_responses WHERE poll_id = ${pollId}
			`)) as unknown as { count: number }[];
			const responsesRemoved = countRows[0]?.count ?? 0;
			if (
				responsesRemoved > 0 &&
				poll.created_by !== session.user.id &&
				(PROJECT_ROLE_RANK[poll.role] ?? 0) < 3
			)
				throw new PollError("poll_delete_owner_or_manager", 403);
			if (responsesRemoved > 0) {
				await tx.execute(sql`
					INSERT INTO audit_events
						(id, workspace_id, actor_type, actor_user_id, entity, entity_id,
						 action, before, request_id, created_at)
					SELECT gen_random_uuid(), ${poll.workspace_id}, 'user', ${session.user.id},
					       'task_poll_responses', response_row.id, 'delete',
					       jsonb_build_object(
						       'task_id', response_row.task_id,
						       'project_id', response_row.project_id,
						       'poll_id', response_row.poll_id,
						       'question', ${poll.question}::text,
						       'response_type', ${poll.response_type}::text,
						       'respondent_id', response_row.respondent_id
					       ),
					       ${c.get("requestId") ?? null}, now()
					FROM task_poll_responses response_row
					WHERE response_row.poll_id = ${pollId}
				`);
			}
			await tx.delete(taskPolls).where(eq(taskPolls.id, pollId));
			await tx.insert(auditEvents).values({
				workspaceId: poll.workspace_id,
				actorUserId: session.user.id,
				entity: "task_polls",
				entityId: pollId,
				action: "delete",
				before: {
					task_id: poll.task_id,
					project_id: poll.project_id,
					question: poll.question,
					response_type: poll.response_type,
					responses_removed: responsesRemoved,
				},
				requestId: c.get("requestId"),
			});
			return { responsesRemoved };
		});
		return c.json({ ok: true, ...removed });
	} catch (error) {
		const mapped = pollSqlError(error);
		if (mapped) return c.json({ error: mapped.code }, mapped.status);
		throw error;
	}
});
