/**
 * F8c — bounded public API and its administrator control plane.
 *
 * Design boundaries:
 * - bearer tokens are high entropy, stored only as SHA-256 hashes and shown once;
 * - every client has explicit scopes and an explicit project allowlist;
 * - writes require an idempotency key and use a transaction-level lock;
 * - the control plane is owner/admin only and remains behind session + 2FA middleware;
 * - webhook delivery is implemented separately in webhookDelivery.ts.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
	and,
	apiClients,
	apiCommandReceipts,
	auditEvents,
	desc,
	eq,
	getDb,
	inArray,
	isNull,
	memberships,
	projects,
	sql,
	tasks,
	webhookDeliveries,
	webhookSubscriptions,
	workspaces,
} from "@watson/db";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";
import { env } from "./env";
import { consumeRateLimit } from "./rateLimit";

export const PUBLIC_API_SCOPES = ["projects:read", "tasks:read", "tasks:write"] as const;
export const WEBHOOK_EVENT_TYPES = [
	"task.created",
	"task.updated",
	"task.completed",
	"task.deleted",
	"project.created",
	"project.updated",
	"project.deleted",
] as const;

type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number];
type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
type ApiClientAuth = {
	id: string;
	workspaceId: string;
	createdBy: string;
	scopes: PublicApiScope[];
	projectIds: string[];
};
type Variables = { requestId: string; apiClient: ApiClientAuth };
type ApiContext = Context<{ Variables: Variables }>;
type DbTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export const publicApiRoutes = new Hono<{ Variables: Variables }>();

const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const taskCreateSchema = z
	.object({
		projectId: uuid,
		name: z.string().trim().min(1).max(500),
		description: z.string().max(50_000).nullable().optional(),
		whyNow: z.string().trim().max(1_000).nullable().optional(),
		priority: z.number().int().min(1).max(4).optional().default(4),
		dueDate: dateOnly.nullable().optional(),
		deadline: dateOnly.nullable().optional(),
		startAt: z.string().datetime({ offset: true }).nullable().optional(),
		startTimezone: z.string().trim().min(1).max(64).nullable().optional(),
		durationMin: z.number().int().min(1).max(10_080).nullable().optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if ((value.startAt == null) !== (value.startTimezone == null)) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: "start_pair_required", path: ["startAt"] });
		}
		if (value.dueDate && value.deadline && value.deadline < value.dueDate) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: "deadline_before_due", path: ["deadline"] });
		}
	});

const taskPatchSchema = z
	.object({
		expectedUpdatedAt: z.string().datetime({ offset: true }),
		name: z.string().trim().min(1).max(500).optional(),
		description: z.string().max(50_000).nullable().optional(),
		whyNow: z.string().trim().max(1_000).nullable().optional(),
		priority: z.number().int().min(1).max(4).optional(),
		dueDate: dateOnly.nullable().optional(),
		deadline: dateOnly.nullable().optional(),
		startAt: z.string().datetime({ offset: true }).nullable().optional(),
		startTimezone: z.string().trim().min(1).max(64).nullable().optional(),
		durationMin: z.number().int().min(1).max(10_080).nullable().optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		const fields = Object.keys(value).filter((key) => key !== "expectedUpdatedAt");
		if (fields.length === 0)
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: "no_changes" });
		const hasStart = Object.hasOwn(value, "startAt");
		const hasZone = Object.hasOwn(value, "startTimezone");
		if (hasStart !== hasZone || (hasStart && (value.startAt == null) !== (value.startTimezone == null))) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: "start_pair_required", path: ["startAt"] });
		}
	});

const clientCreateSchema = z
	.object({
		workspaceId: uuid,
		name: z.string().trim().min(1).max(120),
		scopes: z.array(z.enum(PUBLIC_API_SCOPES)).min(1).max(PUBLIC_API_SCOPES.length),
		projectIds: z.array(uuid).min(1).max(100),
		expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
	})
	.strict();

const webhookCreateSchema = z
	.object({
		workspaceId: uuid,
		name: z.string().trim().min(1).max(120),
		endpointUrl: z.string().trim().url().max(2_048),
		eventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).max(WEBHOOK_EVENT_TYPES.length),
		projectIds: z.array(uuid).min(1).max(100),
	})
	.strict();

const webhookUpdateSchema = z
	.object({
		workspaceId: uuid,
		expectedVersion: z.number().int().positive(),
		active: z.boolean(),
	})
	.strict();

const revokeSchema = z.object({ workspaceId: uuid }).strict();

function unique<T>(items: readonly T[]): T[] {
	return [...new Set(items)];
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function dateValue(value: string | null | undefined): Date | null | undefined {
	return value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

function publicTask(row: typeof tasks.$inferSelect) {
	return {
		id: row.id,
		projectId: row.projectId,
		name: row.name,
		description: row.description,
		whyNow: row.whyNow,
		priority: row.priority,
		dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
		deadline: row.deadline ? row.deadline.toISOString().slice(0, 10) : null,
		startAt: row.startDate?.toISOString() ?? null,
		startTimezone: row.startTimezone,
		durationMin: row.durationMin,
		completedAt: row.completedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function publicProject(row: typeof projects.$inferSelect) {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		name: row.name,
		kind: row.kind,
		status: row.status,
		deliveryDate: row.deliveryDate?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function safeEqualHex(left: string, right: string): boolean {
	if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
	return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function parseBearer(value: string | undefined): { prefix: string; token: string } | null {
	const match = value?.match(/^Bearer (wtn_live_([A-Za-z0-9_-]{8,16})_[A-Za-z0-9_-]{32,64})$/);
	return match?.[1] && match[2] ? { token: match[1], prefix: match[2] } : null;
}

function apiRateKey(clientId: string): string {
	return `public-api:${sha256(`${env.authSecret ?? "watson-dev-rate-limit"}:${clientId}`)}`;
}

function hasScope(c: ApiContext, scope: PublicApiScope): boolean {
	return c.get("apiClient").scopes.includes(scope);
}

function requireScope(c: ApiContext, scope: PublicApiScope): Response | null {
	if (hasScope(c, scope)) return null;
	return c.json({ error: "insufficient_scope", requiredScope: scope }, 403);
}

function idempotencyKey(c: ApiContext): string | null {
	const value = c.req.header("idempotency-key")?.trim();
	return value && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : null;
}

function encodeCursor(updatedAt: Date, id: string): string {
	return Buffer.from(JSON.stringify({ updatedAt: updatedAt.toISOString(), id })).toString("base64url");
}

function decodeCursor(value: string | undefined): { updatedAt: Date; id: string } | null {
	if (!value || value.length > 300) return null;
	try {
		const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
		const result = z
			.object({ updatedAt: z.string().datetime({ offset: true }), id: uuid })
			.strict()
			.safeParse(parsed);
		if (!result.success) return null;
		return { updatedAt: new Date(result.data.updatedAt), id: result.data.id };
	} catch {
		return null;
	}
}

export function webhookSigningSecret(subscriptionId: string): string {
	const root = env.publicWebhookSigningSecret;
	if (!root) throw new Error("public_webhook_signing_secret_missing");
	return `whsec_${createHmac("sha256", root).update(`watson-webhook:v1:${subscriptionId}`).digest("base64url")}`;
}

function validEndpoint(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.username || url.password || url.hash) return false;
		if (url.protocol === "https:") return true;
		return (
			process.env.NODE_ENV !== "production" &&
			url.protocol === "http:" &&
			["localhost", "127.0.0.1", "::1"].includes(url.hostname)
		);
	} catch {
		return false;
	}
}

async function adminSession(c: ApiContext, workspaceId: string) {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return { kind: "unauthorized" as const };
	const db = getDb();
	const workspace = (
		await db
			.select({ ownerId: workspaces.ownerId, role: memberships.role })
			.from(workspaces)
			.leftJoin(
				memberships,
				and(eq(memberships.workspaceId, workspaces.id), eq(memberships.userId, session.user.id)),
			)
			.where(eq(workspaces.id, workspaceId))
			.limit(1)
	)[0];
	if (!workspace) return { kind: "not_found" as const };
	if (workspace.ownerId !== session.user.id && workspace.role !== "admin") {
		return { kind: "forbidden" as const };
	}
	return { kind: "ok" as const, userId: session.user.id };
}

async function projectsBelongToWorkspace(workspaceId: string, projectIds: string[]): Promise<boolean> {
	const ids = unique(projectIds);
	if (ids.length !== projectIds.length) return false;
	const rows = await getDb()
		.select({ id: projects.id })
		.from(projects)
		.where(and(eq(projects.workspaceId, workspaceId), inArray(projects.id, ids)));
	return rows.length === ids.length;
}

type CommandOutcome = {
	statusCode: 200 | 201 | 404 | 409 | 422;
	response: Record<string, unknown>;
	persist: boolean;
};

async function executeIdempotent(
	client: ApiClientAuth,
	key: string,
	action: string,
	payload: unknown,
	run: (tx: DbTx) => Promise<CommandOutcome>,
): Promise<CommandOutcome> {
	const requestHash = sha256(JSON.stringify({ action, payload }));
	return getDb().transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`public-api:${client.id}:${key}`}, 0))`,
		);
		const prior = (
			await tx
				.select()
				.from(apiCommandReceipts)
				.where(
					and(
						eq(apiCommandReceipts.clientId, client.id),
						eq(apiCommandReceipts.idempotencyKey, key),
					),
				)
				.limit(1)
		)[0];
		if (prior) {
			if (prior.requestHash !== requestHash) {
				return {
					statusCode: 409,
					response: { error: "idempotency_key_reused" },
					persist: false,
				};
			}
			return {
				statusCode: prior.statusCode === 201 ? 201 : 200,
				response: prior.response,
				persist: false,
			};
		}
		const outcome = await run(tx);
		if (outcome.persist) {
			await tx.insert(apiCommandReceipts).values({
				clientId: client.id,
				idempotencyKey: key,
				requestHash,
				statusCode: outcome.statusCode,
				response: outcome.response,
			});
		}
		return outcome;
	});
}

const OPENAPI = {
	openapi: "3.1.0",
	info: {
		title: "Watson Public API",
		version: "1.0.0",
		description: "Projektově omezené API pro čtení projektů a čtení či úpravu úkolů.",
	},
	servers: [{ url: "/public/v1" }],
	components: {
		securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "wtn_live" } },
	},
	security: [{ bearerAuth: [] }],
	paths: {
		"/projects": { get: { summary: "List allowed projects", responses: { "200": { description: "OK" } } } },
		"/tasks": {
			get: { summary: "List allowed tasks", responses: { "200": { description: "OK" } } },
			post: {
				summary: "Create a task",
				parameters: [{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string" } }],
				responses: { "201": { description: "Created" } },
			},
		},
		"/tasks/{taskId}": {
			patch: {
				summary: "Update a task with optimistic concurrency",
				parameters: [
					{ in: "path", name: "taskId", required: true, schema: { type: "string", format: "uuid" } },
					{ in: "header", name: "Idempotency-Key", required: true, schema: { type: "string" } },
				],
				responses: { "200": { description: "Updated" }, "409": { description: "Stale version" } },
			},
		},
	},
} as const;

publicApiRoutes.get("/public/v1/openapi.json", (c) => {
	c.header("Cache-Control", "public, max-age=300");
	return c.json(OPENAPI);
});

publicApiRoutes.use("/public/v1/*", async (c, next) => {
	c.header("Cache-Control", "private, no-store, max-age=0");
	c.header("Watson-Api-Version", "2026-07-17");
	const parsed = parseBearer(c.req.header("authorization"));
	if (!parsed) {
		c.header("WWW-Authenticate", 'Bearer realm="Watson", error="invalid_token"');
		return c.json({ error: "unauthorized" }, 401);
	}
	const row = (
		await getDb()
			.select()
			.from(apiClients)
			.where(eq(apiClients.keyPrefix, parsed.prefix))
			.limit(1)
	)[0];
	if (
		!row ||
		row.revokedAt ||
		(row.expiresAt && row.expiresAt.getTime() <= Date.now()) ||
		!safeEqualHex(sha256(parsed.token), row.keyHash)
	) {
		c.header("WWW-Authenticate", 'Bearer realm="Watson", error="invalid_token"');
		return c.json({ error: "unauthorized" }, 401);
	}
	const limit = await consumeRateLimit({ key: apiRateKey(row.id), windowMs: 60_000, max: 120 });
	c.header("X-RateLimit-Limit", "120");
	c.header("X-RateLimit-Remaining", String(Math.max(0, 120 - limit.count)));
	if (!limit.allowed) {
		c.header("Retry-After", String(limit.retryAfter));
		return c.json({ error: "rate_limited" }, 429);
	}
	if (!row.lastUsedAt || row.lastUsedAt.getTime() < Date.now() - 5 * 60_000) {
		await getDb().update(apiClients).set({ lastUsedAt: new Date() }).where(eq(apiClients.id, row.id));
	}
	c.set("apiClient", {
		id: row.id,
		workspaceId: row.workspaceId,
		createdBy: row.createdBy,
		scopes: row.scopes as PublicApiScope[],
		projectIds: row.projectIds,
	});
	await next();
});

publicApiRoutes.get("/public/v1/projects", async (c) => {
	const denied = requireScope(c, "projects:read");
	if (denied) return denied;
	const client = c.get("apiClient");
	const rows = await getDb()
		.select()
		.from(projects)
		.where(
			and(eq(projects.workspaceId, client.workspaceId), inArray(projects.id, client.projectIds)),
		)
		.orderBy(desc(projects.updatedAt), desc(projects.id));
	return c.json({ data: rows.map(publicProject) });
});

publicApiRoutes.get("/public/v1/tasks", async (c) => {
	const denied = requireScope(c, "tasks:read");
	if (denied) return denied;
	const client = c.get("apiClient");
	const query = z
		.object({
			projectId: uuid.optional(),
			limit: z.coerce.number().int().min(1).max(100).optional().default(50),
			cursor: z.string().max(300).optional(),
		})
		.strict()
		.safeParse(c.req.query());
	if (!query.success) return c.json({ error: "invalid_query" }, 422);
	if (query.data.projectId && !client.projectIds.includes(query.data.projectId)) {
		return c.json({ error: "project_not_allowed" }, 403);
	}
	const cursor = query.data.cursor ? decodeCursor(query.data.cursor) : null;
	if (query.data.cursor && !cursor) return c.json({ error: "invalid_cursor" }, 422);
	const projectIds = query.data.projectId ? [query.data.projectId] : client.projectIds;
	const rows = await getDb()
		.select()
		.from(tasks)
		.where(
			and(
				inArray(tasks.projectId, projectIds),
				eq(tasks.kind, "task"),
				cursor
					? sql`(${tasks.updatedAt}, ${tasks.id}) < (${cursor.updatedAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`
					: undefined,
			),
		)
		.orderBy(desc(tasks.updatedAt), desc(tasks.id))
		.limit(query.data.limit + 1);
	const page = rows.slice(0, query.data.limit);
	const last = page.at(-1);
	return c.json({
		data: page.map(publicTask),
		nextCursor: rows.length > query.data.limit && last ? encodeCursor(last.updatedAt, last.id) : null,
	});
});

publicApiRoutes.post("/public/v1/tasks", async (c) => {
	const denied = requireScope(c, "tasks:write");
	if (denied) return denied;
	const key = idempotencyKey(c);
	if (!key) return c.json({ error: "invalid_idempotency_key" }, 400);
	const parsed = taskCreateSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_task", issues: parsed.error.issues }, 422);
	const client = c.get("apiClient");
	if (!client.projectIds.includes(parsed.data.projectId)) {
		return c.json({ error: "project_not_allowed" }, 403);
	}
	const outcome = await executeIdempotent(client, key, "task.create", parsed.data, async (tx) => {
		const project = (
			await tx
				.select({ id: projects.id })
				.from(projects)
				.where(
					and(
						eq(projects.id, parsed.data.projectId),
						eq(projects.workspaceId, client.workspaceId),
					),
				)
				.limit(1)
		)[0];
		if (!project) return { statusCode: 404, response: { error: "project_not_found" }, persist: false };
		const [created] = await tx
			.insert(tasks)
			.values({
				projectId: parsed.data.projectId,
				name: parsed.data.name,
				description: parsed.data.description,
				whyNow: parsed.data.whyNow,
				priority: parsed.data.priority,
				dueDate: dateValue(parsed.data.dueDate),
				deadline: dateValue(parsed.data.deadline),
				startDate:
					parsed.data.startAt === undefined
						? undefined
						: parsed.data.startAt === null
							? null
							: new Date(parsed.data.startAt),
				startTimezone: parsed.data.startTimezone,
				durationMin: parsed.data.durationMin,
				createdBy: client.createdBy,
			})
			.returning();
		if (!created) return { statusCode: 409, response: { error: "create_failed" }, persist: false };
		await tx.insert(auditEvents).values({
			workspaceId: client.workspaceId,
			actorType: "user",
			actorUserId: client.createdBy,
			entity: "task",
			entityId: created.id,
			action: "public_api_create",
			diff: { apiClientId: client.id, projectId: created.projectId },
		});
		return { statusCode: 201, response: { data: publicTask(created) }, persist: true };
	});
	if (outcome.statusCode === 201) return c.json(outcome.response, 201);
	if (outcome.statusCode === 404) return c.json(outcome.response, 404);
	return c.json(outcome.response, outcome.statusCode === 200 ? 200 : 409);
});

publicApiRoutes.patch("/public/v1/tasks/:taskId", async (c) => {
	const denied = requireScope(c, "tasks:write");
	if (denied) return denied;
	const taskId = uuid.safeParse(c.req.param("taskId"));
	if (!taskId.success) return c.json({ error: "invalid_task_id" }, 422);
	const key = idempotencyKey(c);
	if (!key) return c.json({ error: "invalid_idempotency_key" }, 400);
	const parsed = taskPatchSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_task", issues: parsed.error.issues }, 422);
	const client = c.get("apiClient");
	const outcome = await executeIdempotent(client, key, "task.update", { taskId: taskId.data, ...parsed.data }, async (tx) => {
		const before = (
			await tx
				.select()
				.from(tasks)
				.where(and(eq(tasks.id, taskId.data), inArray(tasks.projectId, client.projectIds)))
				.limit(1)
		)[0];
		if (!before) return { statusCode: 404, response: { error: "task_not_found" }, persist: false };
		if (before.updatedAt.getTime() !== new Date(parsed.data.expectedUpdatedAt).getTime()) {
			return {
				statusCode: 409,
				response: { error: "stale_version", currentUpdatedAt: before.updatedAt.toISOString() },
				persist: false,
			};
		}
		const nextDue =
			parsed.data.dueDate === undefined ? before.dueDate : dateValue(parsed.data.dueDate);
		const nextDeadline =
			parsed.data.deadline === undefined ? before.deadline : dateValue(parsed.data.deadline);
		if (
			nextDue instanceof Date &&
			nextDeadline instanceof Date &&
			nextDeadline.getTime() < nextDue.getTime()
		) {
			return {
				statusCode: 422,
				response: { error: "deadline_before_due" },
				persist: false,
			};
		}
		const values = {
			...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
			...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
			...(parsed.data.whyNow !== undefined ? { whyNow: parsed.data.whyNow } : {}),
			...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
			...(parsed.data.dueDate !== undefined ? { dueDate: dateValue(parsed.data.dueDate) } : {}),
			...(parsed.data.deadline !== undefined ? { deadline: dateValue(parsed.data.deadline) } : {}),
			...(parsed.data.startAt !== undefined
				? { startDate: parsed.data.startAt ? new Date(parsed.data.startAt) : null }
				: {}),
			...(parsed.data.startTimezone !== undefined ? { startTimezone: parsed.data.startTimezone } : {}),
			...(parsed.data.durationMin !== undefined ? { durationMin: parsed.data.durationMin } : {}),
			updatedAt: new Date(),
		};
		const [updated] = await tx
			.update(tasks)
			.set(values)
			// PostgreSQL `now()` has microsecond precision while JS Date and the public
			// ISO contract have milliseconds. Compare at the advertised precision;
			// otherwise an untouched row created by a DB default is falsely stale.
			.where(
				and(
					eq(tasks.id, before.id),
					sql`date_trunc('milliseconds', ${tasks.updatedAt}) = date_trunc('milliseconds', ${before.updatedAt.toISOString()}::timestamptz)`,
				),
			)
			.returning();
		if (!updated) {
			return { statusCode: 409, response: { error: "stale_version" }, persist: false };
		}
		await tx.insert(auditEvents).values({
			workspaceId: client.workspaceId,
			actorType: "user",
			actorUserId: client.createdBy,
			entity: "task",
			entityId: updated.id,
			action: "public_api_update",
			before: { updatedAt: before.updatedAt.toISOString() },
			diff: { apiClientId: client.id, fields: Object.keys(values).filter((key) => key !== "updatedAt") },
		});
		return { statusCode: 200, response: { data: publicTask(updated) }, persist: true };
	});
	if (outcome.statusCode === 200) return c.json(outcome.response);
	if (outcome.statusCode === 404) return c.json(outcome.response, 404);
	if (outcome.statusCode === 422) return c.json(outcome.response, 422);
	return c.json(outcome.response, 409);
});

// ── Owner/admin control plane ──────────────────────────────────────────────

publicApiRoutes.get("/api/developer", async (c) => {
	const workspaceId = uuid.safeParse(c.req.query("workspaceId"));
	if (!workspaceId.success) return c.json({ error: "invalid_workspace_id" }, 422);
	const gate = await adminSession(c, workspaceId.data);
	if (gate.kind === "unauthorized") return c.json({ error: "unauthorized" }, 401);
	if (gate.kind === "not_found") return c.json({ error: "not_found" }, 404);
	if (gate.kind === "forbidden") return c.json({ error: "forbidden" }, 403);
	const db = getDb();
	const [clients, subscriptions, allowedProjects] = await Promise.all([
		db.select().from(apiClients).where(eq(apiClients.workspaceId, workspaceId.data)).orderBy(desc(apiClients.createdAt)),
		db
			.select({
				id: webhookSubscriptions.id,
				name: webhookSubscriptions.name,
				endpointUrl: webhookSubscriptions.endpointUrl,
				eventTypes: webhookSubscriptions.eventTypes,
				projectIds: webhookSubscriptions.projectIds,
				active: webhookSubscriptions.active,
				version: webhookSubscriptions.version,
				failureCount: webhookSubscriptions.failureCount,
				lastAttemptAt: webhookSubscriptions.lastAttemptAt,
				lastSuccessAt: webhookSubscriptions.lastSuccessAt,
				lastErrorCode: webhookSubscriptions.lastErrorCode,
				createdAt: webhookSubscriptions.createdAt,
			})
			.from(webhookSubscriptions)
			.where(eq(webhookSubscriptions.workspaceId, workspaceId.data))
			.orderBy(desc(webhookSubscriptions.createdAt)),
		db
			.select({ id: projects.id, name: projects.name, status: projects.status })
			.from(projects)
			.where(eq(projects.workspaceId, workspaceId.data))
			.orderBy(desc(projects.updatedAt)),
	]);
	const subscriptionIds = subscriptions.map((row) => row.id);
	const recentDeliveries = subscriptionIds.length
		? await db
				.select({
					subscriptionId: webhookDeliveries.subscriptionId,
					status: webhookDeliveries.status,
					attemptCount: webhookDeliveries.attemptCount,
					responseStatus: webhookDeliveries.responseStatus,
					lastErrorCode: webhookDeliveries.lastErrorCode,
					deliveredAt: webhookDeliveries.deliveredAt,
					updatedAt: webhookDeliveries.updatedAt,
				})
				.from(webhookDeliveries)
				.where(inArray(webhookDeliveries.subscriptionId, subscriptionIds))
				.orderBy(desc(webhookDeliveries.updatedAt))
				.limit(25)
		: [];
	return c.json({
		clients: clients.map((row) => ({
			id: row.id,
			name: row.name,
			keyPrefix: row.keyPrefix,
			scopes: row.scopes,
			projectIds: row.projectIds,
			lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
			expiresAt: row.expiresAt?.toISOString() ?? null,
			revokedAt: row.revokedAt?.toISOString() ?? null,
			createdAt: row.createdAt.toISOString(),
		})),
		subscriptions: subscriptions.map((row) => ({
			...row,
			lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
			lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
			createdAt: row.createdAt.toISOString(),
		})),
		projects: allowedProjects,
		recentDeliveries: recentDeliveries.map((row) => ({
			...row,
			deliveredAt: row.deliveredAt?.toISOString() ?? null,
			updatedAt: row.updatedAt.toISOString(),
		})),
		openApiUrl: `${env.authUrl.replace(/\/$/, "")}/public/v1/openapi.json`,
	});
});

publicApiRoutes.post("/api/developer/clients", async (c) => {
	const parsed = clientCreateSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_api_client", issues: parsed.error.issues }, 422);
	const gate = await adminSession(c, parsed.data.workspaceId);
	if (gate.kind === "unauthorized") return c.json({ error: "unauthorized" }, 401);
	if (gate.kind === "not_found") return c.json({ error: "not_found" }, 404);
	if (gate.kind === "forbidden") return c.json({ error: "forbidden" }, 403);
	const projectIds = unique(parsed.data.projectIds);
	const scopes = unique(parsed.data.scopes);
	if (
		projectIds.length !== parsed.data.projectIds.length ||
		scopes.length !== parsed.data.scopes.length ||
		!(await projectsBelongToWorkspace(parsed.data.workspaceId, projectIds))
	) {
		return c.json({ error: "invalid_project_scope" }, 422);
	}
	const prefix = randomBytes(12).toString("base64url");
	const token = `wtn_live_${prefix}_${randomBytes(32).toString("base64url")}`;
	const expiresAt = parsed.data.expiresInDays
		? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
		: null;
	const [created] = await getDb()
		.insert(apiClients)
		.values({
			workspaceId: parsed.data.workspaceId,
			createdBy: gate.userId,
			name: parsed.data.name,
			keyPrefix: prefix,
			keyHash: sha256(token),
			scopes,
			projectIds,
			expiresAt,
		})
		.returning();
	if (!created) return c.json({ error: "create_failed" }, 409);
	await getDb().insert(auditEvents).values({
		workspaceId: parsed.data.workspaceId,
		actorType: "user",
		actorUserId: gate.userId,
		entity: "api_client",
		entityId: created.id,
		action: "create",
		diff: { name: created.name, scopes, projectIds, expiresAt: expiresAt?.toISOString() ?? null },
		requestId: c.get("requestId") ?? null,
	});
	return c.json(
		{
			client: { id: created.id, name: created.name, keyPrefix: prefix, scopes, projectIds },
			token,
			warning: "Token se zobrazí pouze jednou. Uložte jej do správce tajemství.",
		},
		201,
	);
});

publicApiRoutes.delete("/api/developer/clients/:clientId", async (c) => {
	const clientId = uuid.safeParse(c.req.param("clientId"));
	const parsed = revokeSchema.safeParse(await c.req.json().catch(() => null));
	if (!clientId.success || !parsed.success) return c.json({ error: "invalid_revoke" }, 422);
	const gate = await adminSession(c, parsed.data.workspaceId);
	if (gate.kind === "unauthorized") return c.json({ error: "unauthorized" }, 401);
	if (gate.kind === "not_found") return c.json({ error: "not_found" }, 404);
	if (gate.kind === "forbidden") return c.json({ error: "forbidden" }, 403);
	const [revoked] = await getDb()
		.update(apiClients)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(apiClients.id, clientId.data),
				eq(apiClients.workspaceId, parsed.data.workspaceId),
				isNull(apiClients.revokedAt),
			),
		)
		.returning();
	if (revoked) {
		await getDb().insert(auditEvents).values({
			workspaceId: parsed.data.workspaceId,
			actorType: "user",
			actorUserId: gate.userId,
			entity: "api_client",
			entityId: revoked.id,
			action: "revoke",
			requestId: c.get("requestId") ?? null,
		});
	}
	return c.json({ ok: true });
});

publicApiRoutes.post("/api/developer/webhooks", async (c) => {
	const parsed = webhookCreateSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success || !validEndpoint(parsed.data.endpointUrl)) {
		return c.json({ error: "invalid_webhook", ...(parsed.success ? {} : { issues: parsed.error.issues }) }, 422);
	}
	const gate = await adminSession(c, parsed.data.workspaceId);
	if (gate.kind === "unauthorized") return c.json({ error: "unauthorized" }, 401);
	if (gate.kind === "not_found") return c.json({ error: "not_found" }, 404);
	if (gate.kind === "forbidden") return c.json({ error: "forbidden" }, 403);
	const projectIds = unique(parsed.data.projectIds);
	const eventTypes = unique(parsed.data.eventTypes) as WebhookEventType[];
	if (
		projectIds.length !== parsed.data.projectIds.length ||
		eventTypes.length !== parsed.data.eventTypes.length ||
		!(await projectsBelongToWorkspace(parsed.data.workspaceId, projectIds))
	) {
		return c.json({ error: "invalid_webhook_scope" }, 422);
	}
	const [created] = await getDb()
		.insert(webhookSubscriptions)
		.values({
			workspaceId: parsed.data.workspaceId,
			createdBy: gate.userId,
			name: parsed.data.name,
			endpointUrl: parsed.data.endpointUrl,
			eventTypes,
			projectIds,
		})
		.returning();
	if (!created) return c.json({ error: "create_failed" }, 409);
	await getDb().insert(auditEvents).values({
		workspaceId: parsed.data.workspaceId,
		actorType: "user",
		actorUserId: gate.userId,
		entity: "webhook_subscription",
		entityId: created.id,
		action: "create",
		// Endpoint paths and query strings often carry receiver-side credentials;
		// keep them in the server-only subscription, never in the synced audit log.
		diff: { name: created.name, eventTypes, projectIds },
		requestId: c.get("requestId") ?? null,
	});
	return c.json(
		{
			subscription: { id: created.id, name: created.name, eventTypes, projectIds, version: 1 },
			signingSecret: webhookSigningSecret(created.id),
			warning: "Podpisový secret se zobrazí pouze jednou.",
		},
		201,
	);
});

publicApiRoutes.patch("/api/developer/webhooks/:subscriptionId", async (c) => {
	const subscriptionId = uuid.safeParse(c.req.param("subscriptionId"));
	const parsed = webhookUpdateSchema.safeParse(await c.req.json().catch(() => null));
	if (!subscriptionId.success || !parsed.success) return c.json({ error: "invalid_webhook_update" }, 422);
	const gate = await adminSession(c, parsed.data.workspaceId);
	if (gate.kind === "unauthorized") return c.json({ error: "unauthorized" }, 401);
	if (gate.kind === "not_found") return c.json({ error: "not_found" }, 404);
	if (gate.kind === "forbidden") return c.json({ error: "forbidden" }, 403);
	const [updated] = await getDb()
		.update(webhookSubscriptions)
		.set({ active: parsed.data.active, version: parsed.data.expectedVersion + 1 })
		.where(
			and(
				eq(webhookSubscriptions.id, subscriptionId.data),
				eq(webhookSubscriptions.workspaceId, parsed.data.workspaceId),
				eq(webhookSubscriptions.version, parsed.data.expectedVersion),
			),
		)
		.returning();
	if (!updated) return c.json({ error: "stale_version" }, 409);
	await getDb().insert(auditEvents).values({
		workspaceId: parsed.data.workspaceId,
		actorType: "user",
		actorUserId: gate.userId,
		entity: "webhook_subscription",
		entityId: updated.id,
		action: updated.active ? "enable" : "disable",
		diff: { active: updated.active, version: updated.version },
		requestId: c.get("requestId") ?? null,
	});
	return c.json({ ok: true, version: updated.version, active: updated.active });
});
