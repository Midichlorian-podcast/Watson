import {
	and,
	auditEvents,
	CUSTOM_FIELD_TYPES,
	eq,
	getDb,
	projectCustomFields,
	sql,
	taskCustomFieldValues,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

const uuid = z.string().uuid();
const fieldType = z.enum(CUSTOM_FIELD_TYPES);
const optionLabels = z
	.array(z.string().trim().min(1).max(120))
	.min(2)
	.max(50)
	.refine(
		(labels) => new Set(labels.map((label) => label.toLocaleLowerCase())).size === labels.length,
		"duplicate_options",
	);
const createSchema = z
	.object({
		id: uuid,
		name: z.string().trim().min(1).max(120),
		fieldType,
		options: optionLabels.optional(),
		position: z.number().int().min(0).max(999).optional(),
	})
	.strict()
	.superRefine((body, context) => {
		if (body.fieldType === "select" && !body.options) {
			context.addIssue({ code: "custom", path: ["options"], message: "options_required" });
		}
		if (body.fieldType !== "select" && body.options !== undefined) {
			context.addIssue({ code: "custom", path: ["options"], message: "options_not_allowed" });
		}
	});
const updateSchema = z
	.object({
		name: z.string().trim().min(1).max(120).optional(),
		options: optionLabels.optional(),
		position: z.number().int().min(0).max(999).optional(),
	})
	.strict()
	.refine((body) => Object.keys(body).length > 0, "nothing_to_update");
const valueSchema = z.object({ value: z.unknown().nullable() }).strict();

const PROJECT_ROLE_RANK: Record<string, number> = { commenter: 1, editor: 2, manager: 3 };
const MAX_FIELDS_PER_PROJECT = 40;

type Access = {
	project_id: string;
	workspace_id: string;
	role: string;
};
type DefinitionRow = Access & {
	id: string;
	name: string;
	field_type: (typeof CUSTOM_FIELD_TYPES)[number];
	options: { id: string; label: string }[];
	position: number;
};

class CustomFieldError extends Error {
	constructor(
		readonly code: string,
		readonly status: 403 | 404 | 409 | 422,
	) {
		super(code);
	}
}

function sqlState(error: unknown): string | null {
	let current: unknown = error;
	for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
		const value = current as { code?: unknown; cause?: unknown };
		if (typeof value.code === "string" && /^[0-9A-Z]{5}$/.test(value.code)) return value.code;
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

async function projectAccess(
	tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
	projectId: string,
	userId: string,
): Promise<Access> {
	const rows = (await tx.execute(sql`
		SELECT p.id AS project_id, p.workspace_id, pm.role::text AS role
		FROM projects p
		JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
		WHERE p.id = ${projectId}
		LIMIT 1
	`)) as unknown as Access[];
	if (!rows[0]) throw new CustomFieldError("not_found", 404);
	return rows[0];
}

async function fieldAccess(
	tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
	fieldId: string,
	userId: string,
): Promise<DefinitionRow> {
	const rows = (await tx.execute(sql`
		SELECT f.id, f.project_id, p.workspace_id, pm.role::text AS role,
		       f.name, f.field_type, f.options, f.position
		FROM project_custom_fields f
		JOIN projects p ON p.id = f.project_id
		JOIN project_members pm ON pm.project_id = f.project_id AND pm.user_id = ${userId}
		WHERE f.id = ${fieldId}
		LIMIT 1
	`)) as unknown as DefinitionRow[];
	if (!rows[0]) throw new CustomFieldError("custom_field_not_found", 404);
	return rows[0];
}

function requireEditor(role: string) {
	if ((PROJECT_ROLE_RANK[role] ?? 0) < 2) throw new CustomFieldError("forbidden", 403);
}

async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
	try {
		return schema.parse(await request.json());
	} catch {
		return null;
	}
}

function normalizedValue(definition: DefinitionRow, value: unknown): unknown {
	if (value === null) return null;
	switch (definition.field_type) {
		case "text":
			if (typeof value !== "string" || value.length > 4000)
				throw new CustomFieldError("invalid_custom_field_value", 422);
			return value;
		case "number":
			if (
				typeof value !== "number" ||
				!Number.isFinite(value) ||
				Math.abs(value) > 1_000_000_000_000_000
			)
				throw new CustomFieldError("invalid_custom_field_value", 422);
			return value;
		case "select":
			if (
				typeof value !== "string" ||
				!definition.options.some((option) => option.id === value)
			)
				throw new CustomFieldError("invalid_custom_field_value", 422);
			return value;
		case "date": {
			if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
				throw new CustomFieldError("invalid_custom_field_value", 422);
			const date = new Date(`${value}T00:00:00Z`);
			if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
				throw new CustomFieldError("invalid_custom_field_value", 422);
			return value;
		}
		case "checkbox":
			if (typeof value !== "boolean")
				throw new CustomFieldError("invalid_custom_field_value", 422);
			return value;
		case "url": {
			if (typeof value !== "string" || value.length > 2048)
				throw new CustomFieldError("invalid_custom_field_value", 422);
			try {
				const url = new URL(value);
				if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
				return url.toString();
			} catch {
				throw new CustomFieldError("invalid_custom_field_value", 422);
			}
		}
		case "person":
			if (typeof value !== "string" || !uuid.safeParse(value).success)
				throw new CustomFieldError("invalid_custom_field_value", 422);
			return value;
	}
}

export const customFieldRoutes = new Hono<{ Variables: { requestId: string } }>();

customFieldRoutes.post("/api/projects/:projectId/custom-fields", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const projectId = c.req.param("projectId");
	const body = await parseBody(c.req.raw, createSchema);
	if (!uuid.safeParse(projectId).success || !body)
		return c.json({ error: "invalid_custom_field" }, 422);
	try {
		const result = await getDb().transaction(async (tx) => {
			const access = await projectAccess(tx, projectId, session.user.id);
			requireEditor(access.role);
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`custom-fields:${projectId}`}, 0))`,
			);
			const existing = (
				await tx.select().from(projectCustomFields).where(eq(projectCustomFields.id, body.id))
			)[0];
			const options = body.fieldType === "select" ? optionsFromLabels(body.options ?? []) : [];
			if (existing) {
				const same =
					existing.projectId === projectId &&
					existing.name === body.name &&
					existing.fieldType === body.fieldType &&
					canonical(existing.options.map((option) => option.label)) === canonical(body.options ?? []) &&
					(body.position === undefined || existing.position === body.position);
				if (!same) throw new CustomFieldError("custom_field_id_conflict", 409);
				return { field: existing, replayed: true };
			}
			const countRows = (await tx.execute(sql`
				SELECT count(*)::int AS count FROM project_custom_fields WHERE project_id = ${projectId}
			`)) as unknown as { count: number }[];
			if ((countRows[0]?.count ?? 0) >= MAX_FIELDS_PER_PROJECT)
				throw new CustomFieldError("custom_field_limit", 409);
			const [field] = await tx
				.insert(projectCustomFields)
				.values({
					id: body.id,
					projectId,
					name: body.name,
					fieldType: body.fieldType,
					options,
					position: body.position ?? (countRows[0]?.count ?? 0),
					createdBy: session.user.id,
				})
				.returning();
			if (!field) throw new CustomFieldError("custom_field_create_failed", 409);
			await tx.insert(auditEvents).values({
				workspaceId: access.workspace_id,
				actorUserId: session.user.id,
				entity: "project_custom_fields",
				entityId: field.id,
				action: "create",
				diff: {
					project_id: projectId,
					name: field.name,
					field_type: field.fieldType,
					options: field.options,
				},
				requestId: c.get("requestId"),
			});
			return { field, replayed: false };
		});
		return c.json(result, result.replayed ? 200 : 201);
	} catch (error) {
		if (error instanceof CustomFieldError) return c.json({ error: error.code }, error.status);
		if (sqlState(error) === "23505")
			return c.json({ error: "custom_field_name_conflict" }, 409);
		throw error;
	}
});

customFieldRoutes.patch("/api/custom-fields/:fieldId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const fieldId = c.req.param("fieldId");
	const body = await parseBody(c.req.raw, updateSchema);
	if (!uuid.safeParse(fieldId).success || !body)
		return c.json({ error: "invalid_custom_field" }, 422);
	try {
		const field = await getDb().transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`custom-field:${fieldId}`}, 0))`,
			);
			const current = await fieldAccess(tx, fieldId, session.user.id);
			requireEditor(current.role);
			if (body.options && current.field_type !== "select")
				throw new CustomFieldError("options_not_allowed", 422);
			const nextOptions = body.options
				? optionsFromLabels(body.options, current.options)
				: current.options;
			const [updated] = await tx
				.update(projectCustomFields)
				.set({
					name: body.name ?? current.name,
					options: nextOptions,
					position: body.position ?? current.position,
					updatedAt: new Date(),
				})
				.where(eq(projectCustomFields.id, fieldId))
				.returning();
			if (!updated) throw new CustomFieldError("custom_field_not_found", 404);
			await tx.insert(auditEvents).values({
				workspaceId: current.workspace_id,
				actorUserId: session.user.id,
				entity: "project_custom_fields",
				entityId: fieldId,
				action: "update",
				before: { name: current.name, options: current.options, position: current.position },
				diff: {
					project_id: current.project_id,
					name: updated.name,
					options: updated.options,
					position: updated.position,
				},
				requestId: c.get("requestId"),
			});
			return updated;
		});
		return c.json({ field });
	} catch (error) {
		if (error instanceof CustomFieldError) return c.json({ error: error.code }, error.status);
		if (sqlState(error) === "23505")
			return c.json({ error: "custom_field_name_conflict" }, 409);
		if (sqlState(error) === "23514")
			return c.json({ error: "custom_field_option_in_use" }, 409);
		throw error;
	}
});

customFieldRoutes.delete("/api/custom-fields/:fieldId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const fieldId = c.req.param("fieldId");
	const confirm = c.req.query("confirm")?.trim();
	if (!uuid.safeParse(fieldId).success || !confirm)
		return c.json({ error: "invalid_custom_field_delete" }, 422);
	try {
		const removed = await getDb().transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`custom-field:${fieldId}`}, 0))`,
			);
			const current = await fieldAccess(tx, fieldId, session.user.id);
			requireEditor(current.role);
			if (current.name !== confirm) throw new CustomFieldError("custom_field_confirmation_mismatch", 409);
			const countRows = (await tx.execute(sql`
				SELECT count(*)::int AS count FROM task_custom_field_values WHERE field_id = ${fieldId}
			`)) as unknown as { count: number }[];
			const valuesRemoved = countRows[0]?.count ?? 0;
			if (valuesRemoved > 0 && (PROJECT_ROLE_RANK[current.role] ?? 0) < 3)
				throw new CustomFieldError("custom_field_delete_manager_only", 403);
			if (valuesRemoved > 0) {
				await tx.execute(sql`
					INSERT INTO audit_events
						(id, workspace_id, actor_type, actor_user_id, entity, entity_id,
						 action, before, request_id, created_at)
					SELECT gen_random_uuid(), ${current.workspace_id}, 'user', ${session.user.id},
					       'task_custom_field_values', value_row.id, 'delete',
					       jsonb_build_object(
						       'task_id', value_row.task_id,
						       'project_id', value_row.project_id,
						       'field_id', value_row.field_id,
						       'field_name', ${current.name}::text,
						       'field_type', ${current.field_type}::text,
						       'value', value_row.value
					       ),
					       ${c.get("requestId") ?? null}, now()
					FROM task_custom_field_values value_row
					WHERE value_row.field_id = ${fieldId}
				`);
			}
			await tx.delete(projectCustomFields).where(eq(projectCustomFields.id, fieldId));
			await tx.insert(auditEvents).values({
				workspaceId: current.workspace_id,
				actorUserId: session.user.id,
				entity: "project_custom_fields",
				entityId: fieldId,
				action: "delete",
				before: {
					project_id: current.project_id,
					name: current.name,
					field_type: current.field_type,
					values_removed: valuesRemoved,
				},
				requestId: c.get("requestId"),
			});
			return { valuesRemoved };
		});
		return c.json({ ok: true, ...removed });
	} catch (error) {
		if (error instanceof CustomFieldError) return c.json({ error: error.code }, error.status);
		throw error;
	}
});

customFieldRoutes.put("/api/tasks/:taskId/custom-fields/:fieldId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const taskId = c.req.param("taskId");
	const fieldId = c.req.param("fieldId");
	const body = await parseBody(c.req.raw, valueSchema);
	if (!uuid.safeParse(taskId).success || !uuid.safeParse(fieldId).success || !body)
		return c.json({ error: "invalid_custom_field_value" }, 422);
	try {
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`custom-field:${fieldId}`}, 0))`,
			);
			const definition = await fieldAccess(tx, fieldId, session.user.id);
			requireEditor(definition.role);
			const taskRows = (await tx.execute(sql`
				SELECT id FROM tasks WHERE id = ${taskId} AND project_id = ${definition.project_id} LIMIT 1
			`)) as unknown as { id: string }[];
			if (!taskRows[0]) throw new CustomFieldError("task_not_found", 404);
			const value = normalizedValue(definition, body.value);
			if (definition.field_type === "person" && value !== null) {
				const memberRows = (await tx.execute(sql`
					SELECT 1 FROM project_members
					WHERE project_id = ${definition.project_id} AND user_id = ${String(value)}
					LIMIT 1
				`)) as unknown as { "?column?": number }[];
				if (!memberRows[0]) throw new CustomFieldError("invalid_custom_field_value", 422);
			}
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`task-field:${taskId}:${fieldId}`}, 0))`,
			);
			const current = (
				await tx
					.select()
					.from(taskCustomFieldValues)
					.where(
						and(
							eq(taskCustomFieldValues.taskId, taskId),
							eq(taskCustomFieldValues.fieldId, fieldId),
						),
					)
			)[0];
			const valueId = current?.id ?? crypto.randomUUID();
			if (value === null) {
				if (!current) return { value: null, unchanged: true };
				await tx.delete(taskCustomFieldValues).where(eq(taskCustomFieldValues.id, current.id));
			} else if (!current) {
				await tx.insert(taskCustomFieldValues).values({
					id: valueId,
					fieldId,
					taskId,
					projectId: definition.project_id,
					value,
					updatedBy: session.user.id,
				});
			} else if (canonical(current.value) === canonical(value)) {
				return { value, unchanged: true };
			} else {
				await tx
					.update(taskCustomFieldValues)
					.set({ value, updatedBy: session.user.id, updatedAt: new Date() })
					.where(eq(taskCustomFieldValues.id, current.id));
			}
			await tx.insert(auditEvents).values({
				workspaceId: definition.workspace_id,
				actorUserId: session.user.id,
				entity: "task_custom_field_values",
				entityId: valueId,
				action: value === null ? "delete" : current ? "update" : "create",
				before: current
					? {
							task_id: taskId,
							field_id: fieldId,
							field_name: definition.name,
							field_type: definition.field_type,
							value: current.value,
						}
					: null,
				diff: {
					task_id: taskId,
					project_id: definition.project_id,
					field_id: fieldId,
					field_name: definition.name,
					field_type: definition.field_type,
					value,
				},
				requestId: c.get("requestId"),
			});
			return { value, unchanged: false };
		});
		return c.json({ ok: true, ...result });
	} catch (error) {
		if (error instanceof CustomFieldError) return c.json({ error: error.code }, error.status);
		throw error;
	}
});
