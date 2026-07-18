import {
	and,
	auditEvents,
	eq,
	getDb,
	inArray,
	memberships,
	projects,
	filters as savedViews,
	users,
	workspaces,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

const uuid = z.string().uuid();
const uniqueArray = <T extends z.ZodTypeAny>(item: T, max: number) =>
	z.array(item).max(max).refine((values) => new Set(values).size === values.length, "duplicate_values");
const personFilter = z.string().refine(
	(value) => ["me", "__none__", "__multi__"].includes(value) || uuid.safeParse(value).success,
	"invalid_person_filter",
);

export const savedTaskViewConfigSchema = z
	.object({
		priorities: uniqueArray(z.number().int().min(1).max(4), 4),
		statuses: uniqueArray(z.enum(["probiha", "kontrola", "", "hotovo"]), 4),
		projects: uniqueArray(uuid, 100),
		people: uniqueArray(personFilter, 100),
		due: uniqueArray(z.enum(["overdue", "today", "next7", "none"]), 4),
		sortBy: z.enum(["smart", "due", "priority", "name", "project", "status"]),
		asc: z.boolean(),
		showDone: z.boolean(),
		groupBy: z.enum(["project", "priority", "status", "none"]),
		viewMode: z.enum(["list", "board"]),
		density: z.enum(["vzdusne", "vyvazene", "kompaktni"]),
	})
	.strict();

export const savedUpcomingViewConfigSchema = savedTaskViewConfigSchema.extend({
	viewMode: z.enum(["list", "board", "calendar"]),
	workspaceFilter: uuid.nullable(),
});

const savedViewSurfaceSchema = z.enum(["tasks", "upcoming"]);
const configForSurface = (surface: z.infer<typeof savedViewSurfaceSchema>, raw: unknown) =>
	(surface === "upcoming" ? savedUpcomingViewConfigSchema : savedTaskViewConfigSchema).safeParse(raw);

const createSchema = z
	.object({
		id: uuid,
		workspaceId: uuid,
		name: z.string().trim().min(1).max(160),
		scope: z.enum(["personal", "team"]),
		surface: savedViewSurfaceSchema.default("tasks"),
		config: z.unknown(),
	})
	.strict();
const updateSchema = z
	.object({
		name: z.string().trim().min(1).max(160),
		config: z.unknown(),
		expectedVersion: z.number().int().positive(),
	})
	.strict();

class ViewError extends Error {
	constructor(
		readonly status: 403 | 404 | 409 | 422,
		readonly code: string,
	) {
		super(code);
	}
}

const isManager = (role: string | null | undefined, owner: boolean) =>
	owner || role === "manager" || role === "admin";

async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
	try {
		return schema.parse(await request.json());
	} catch {
		return null;
	}
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export const savedViewRoutes = new Hono<{ Variables: { requestId: string } }>();

savedViewRoutes.post("/api/saved-views", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const body = await parseJson(c.req.raw, createSchema);
	if (!body) return c.json({ error: "invalid_saved_view" }, 422);
	const surface = body.surface ?? "tasks";
	const parsedConfig = configForSurface(surface, body.config);
	if (!parsedConfig.success) return c.json({ error: "invalid_saved_view" }, 422);
	const config = parsedConfig.data;
	const ownerScope = body.scope === "team" ? "workspace" : "user";

	try {
		const result = await getDb().transaction(async (tx) => {
			const workspace = (
				await tx
					.select({ ownerId: workspaces.ownerId })
					.from(workspaces)
					.where(eq(workspaces.id, body.workspaceId))
			)[0];
			const membership = (
				await tx
					.select({ role: memberships.role })
					.from(memberships)
					.where(
						and(
							eq(memberships.workspaceId, body.workspaceId),
							eq(memberships.userId, session.user.id),
						),
					)
			)[0];
			const owner = workspace?.ownerId === session.user.id;
			if (!workspace || (!membership && !owner) || membership?.role === "guest")
				throw new ViewError(403, "forbidden");
			if (ownerScope === "workspace" && !isManager(membership?.role, owner))
				throw new ViewError(403, "team_view_manager_only");

			if (config.projects.length > 0) {
				const valid = await tx
					.select({ id: projects.id })
					.from(projects)
					.where(
						and(
							eq(projects.workspaceId, body.workspaceId),
							inArray(projects.id, config.projects),
							ownerScope === "workspace" ? eq(projects.visibility, "team") : undefined,
						),
					);
				if (valid.length !== config.projects.length)
					throw new ViewError(422, "invalid_project_scope");
			}
			const people = config.people.filter((value) => uuid.safeParse(value).success);
			if (people.length > 0) {
				const valid = await tx
					.select({ id: users.id })
					.from(memberships)
					.innerJoin(users, eq(users.id, memberships.userId))
					.where(
						and(
							eq(memberships.workspaceId, body.workspaceId),
							inArray(memberships.userId, people),
						),
					);
				if (valid.length !== people.length) throw new ViewError(422, "invalid_person_scope");
			}

			const existing = (
				await tx.select().from(savedViews).where(eq(savedViews.id, body.id))
			)[0];
			if (existing) {
				const same =
					existing.workspaceId === body.workspaceId &&
					existing.userId === session.user.id &&
					existing.ownerScope === ownerScope &&
					existing.name === body.name &&
					existing.surface === surface &&
					canonicalJson(existing.config) === canonicalJson(config);
				if (!same) throw new ViewError(409, "saved_view_id_conflict");
				return { view: existing, replayed: true };
			}

			const [view] = await tx
				.insert(savedViews)
				.values({
					id: body.id,
					ownerScope,
					userId: session.user.id,
					workspaceId: body.workspaceId,
					name: body.name,
					query: `${surface}:v1`,
					surface,
					config,
				})
				.returning();
			if (!view) throw new ViewError(409, "saved_view_create_failed");
			await tx.insert(auditEvents).values({
				workspaceId: body.workspaceId,
				actorUserId: session.user.id,
				entity: "filters",
				entityId: view.id,
				action: "create",
				diff: { name: view.name, scope: view.ownerScope, config: view.config },
				requestId: c.get("requestId"),
			});
			return { view, replayed: false };
		});
		return c.json(result, result.replayed ? 200 : 201);
	} catch (error) {
		if (error instanceof ViewError) return c.json({ error: error.code }, error.status);
		if ((error as { code?: string }).code === "23505")
			return c.json({ error: "saved_view_name_conflict" }, 409);
		throw error;
	}
});

savedViewRoutes.patch("/api/saved-views/:id", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const id = uuid.safeParse(c.req.param("id"));
	const body = await parseJson(c.req.raw, updateSchema);
	if (!id.success || !body) return c.json({ error: "invalid_saved_view" }, 422);

	try {
		const view = await getDb().transaction(async (tx) => {
			const current = (
				await tx.select().from(savedViews).where(eq(savedViews.id, id.data))
			)[0];
			if (
				!current?.workspaceId ||
				(current.query !== "tasks:v1" && current.query !== "upcoming:v1") ||
				(current.surface !== "tasks" && current.surface !== "upcoming")
			)
				throw new ViewError(404, "saved_view_not_found");
			const parsedConfig = configForSurface(current.surface, body.config);
			if (!parsedConfig.success) throw new ViewError(422, "invalid_saved_view");
			const config = parsedConfig.data;
			const workspace = (
				await tx
					.select({ ownerId: workspaces.ownerId })
					.from(workspaces)
					.where(eq(workspaces.id, current.workspaceId))
			)[0];
			const membership = (
				await tx
					.select({ role: memberships.role })
					.from(memberships)
					.where(
						and(
							eq(memberships.workspaceId, current.workspaceId),
							eq(memberships.userId, session.user.id),
						),
					)
			)[0];
			const owner = workspace?.ownerId === session.user.id;
			const canEdit =
				current.ownerScope === "user"
					? current.userId === session.user.id
					: isManager(membership?.role, owner);
			if (!canEdit) throw new ViewError(403, "forbidden");

			if (config.projects.length > 0) {
				const valid = await tx
					.select({ id: projects.id })
					.from(projects)
					.where(
						and(
							eq(projects.workspaceId, current.workspaceId),
							inArray(projects.id, config.projects),
							current.ownerScope === "workspace"
								? eq(projects.visibility, "team")
								: undefined,
						),
					);
				if (valid.length !== config.projects.length)
					throw new ViewError(422, "invalid_project_scope");
			}
			const people = config.people.filter((value) => uuid.safeParse(value).success);
			if (people.length > 0) {
				const valid = await tx
					.select({ id: memberships.userId })
					.from(memberships)
					.where(
						and(
							eq(memberships.workspaceId, current.workspaceId),
							inArray(memberships.userId, people),
						),
					);
				if (valid.length !== people.length) throw new ViewError(422, "invalid_person_scope");
			}

			const [updated] = await tx
				.update(savedViews)
				.set({
					name: body.name,
					config,
					version: current.version + 1,
					updatedAt: new Date(),
				})
				.where(
					and(eq(savedViews.id, current.id), eq(savedViews.version, body.expectedVersion)),
				)
				.returning();
			if (!updated) throw new ViewError(409, "saved_view_stale");
			await tx.insert(auditEvents).values({
				workspaceId: current.workspaceId,
				actorUserId: session.user.id,
				entity: "filters",
				entityId: current.id,
				action: "update",
				before: { name: current.name, config: current.config, version: current.version },
				diff: { name: updated.name, config: updated.config, version: updated.version },
				requestId: c.get("requestId"),
			});
			return updated;
		});
		return c.json({ view });
	} catch (error) {
		if (error instanceof ViewError) return c.json({ error: error.code }, error.status);
		if ((error as { code?: string }).code === "23505")
			return c.json({ error: "saved_view_name_conflict" }, 409);
		throw error;
	}
});

savedViewRoutes.delete("/api/saved-views/:id", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const id = uuid.safeParse(c.req.param("id"));
	const expectedVersion = z.coerce.number().int().positive().safeParse(c.req.query("version"));
	if (!id.success || !expectedVersion.success)
		return c.json({ error: "invalid_saved_view" }, 422);

	try {
		await getDb().transaction(async (tx) => {
			const current = (
				await tx.select().from(savedViews).where(eq(savedViews.id, id.data))
			)[0];
			if (
				!current?.workspaceId ||
				(current.query !== "tasks:v1" && current.query !== "upcoming:v1")
			)
				throw new ViewError(404, "saved_view_not_found");
			const workspace = (
				await tx
					.select({ ownerId: workspaces.ownerId })
					.from(workspaces)
					.where(eq(workspaces.id, current.workspaceId))
			)[0];
			const membership = (
				await tx
					.select({ role: memberships.role })
					.from(memberships)
					.where(
						and(
							eq(memberships.workspaceId, current.workspaceId),
							eq(memberships.userId, session.user.id),
						),
					)
			)[0];
			const owner = workspace?.ownerId === session.user.id;
			const canEdit =
				current.ownerScope === "user"
					? current.userId === session.user.id
					: isManager(membership?.role, owner);
			if (!canEdit) throw new ViewError(403, "forbidden");
			const [deleted] = await tx
				.delete(savedViews)
				.where(
					and(
						eq(savedViews.id, current.id),
						eq(savedViews.version, expectedVersion.data),
					),
				)
				.returning();
			if (!deleted) throw new ViewError(409, "saved_view_stale");
			await tx.insert(auditEvents).values({
				workspaceId: current.workspaceId,
				actorUserId: session.user.id,
				entity: "filters",
				entityId: current.id,
				action: "delete",
				before: current,
				requestId: c.get("requestId"),
			});
		});
		return c.json({ ok: true });
	} catch (error) {
		if (error instanceof ViewError) return c.json({ error: error.code }, error.status);
		throw error;
	}
});
