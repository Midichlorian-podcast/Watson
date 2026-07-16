import {
	assignments,
	auditEvents,
	getDb,
	importAttachments,
	importBatches,
	importItems,
	labels,
	sections,
	sql,
	statuses,
	taskLabels,
	tasks,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

export const importRoutes = new Hono<{ Variables: { requestId: string } }>();

const uuid = z.string().uuid();
const dateOnly = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine((value) => {
		const parsed = new Date(`${value}T00:00:00.000Z`);
		return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
	});
const itemSchema = z
	.object({
		sourceKey: z.string().trim().min(1).max(200),
		parentSourceKey: z.string().trim().min(1).max(200).nullable().optional().default(null),
		name: z.string().trim().min(1).max(500),
		description: z.string().max(100_000).nullable().optional().default(null),
		sectionName: z.string().trim().min(1).max(200).nullable().optional().default(null),
		dueDate: dateOnly.nullable().optional().default(null),
		priority: z.number().int().min(1).max(4).optional().default(4),
		completed: z.boolean().optional().default(false),
		assigneeIds: z.array(uuid).max(20).optional().default([]),
		labels: z.array(z.string().trim().min(1).max(100)).max(50).optional().default([]),
		attachmentNames: z.array(z.string().trim().min(1).max(255)).max(50).optional().default([]),
	})
	.strict();
const commandSchema = z
	.object({
		importId: uuid,
		projectId: uuid,
		source: z.enum(["csv", "asana", "trello", "todoist"]),
		sourceName: z.string().trim().min(1).max(255),
		sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
		items: z.array(itemSchema).min(1).max(2000),
	})
	.strict();
const registerAttachmentSchema = z
	.object({ itemId: uuid, attachmentId: uuid })
	.strict();
const rollbackSchema = z
	.object({
		confirmSourceName: z.string().min(1).max(255),
		expectedUpdatedAt: z.string().datetime({ offset: true }),
	})
	.strict();

type Command = z.infer<typeof commandSchema>;
type CommandItem = z.infer<typeof itemSchema>;
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Access = {
	project_id: string;
	workspace_id: string;
	project_role: string;
	workspace_role: string | null;
	workspace_owner_id: string | null;
	project_owner_id: string | null;
};
type ImportErrorItem = { sourceKey: string; field: string; code: string };

class ImportApiError extends Error {
	constructor(
		readonly code: string,
		readonly status: 403 | 404 | 409,
		readonly detail?: unknown,
	) {
		super(code);
	}
}

function canImport(access: Access, userId: string) {
	return (
		access.workspace_owner_id === userId ||
		access.project_owner_id === userId ||
		access.workspace_role === "admin" ||
		access.project_role === "manager" ||
		access.project_role === "editor"
	);
}

async function projectAccess(tx: Tx, projectId: string, userId: string): Promise<Access> {
	const rows = (await tx.execute(sql`
		SELECT p.id AS project_id, p.workspace_id, pm.role::text AS project_role,
		       wm.role::text AS workspace_role, w.owner_id AS workspace_owner_id,
		       p.owner_id AS project_owner_id
		FROM projects p
		JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
		JOIN workspaces w ON w.id = p.workspace_id
		LEFT JOIN memberships wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${userId}
		WHERE p.id = ${projectId}
		LIMIT 1
	`)) as unknown as Access[];
	const access = rows[0];
	if (!access) throw new ImportApiError("import_project_not_found", 404);
	if (!canImport(access, userId)) throw new ImportApiError("import_forbidden", 403);
	return access;
}

function unique(values: string[]) {
	return [...new Set(values)];
}

function normalizedCommand(command: Command): Command {
	return {
		...command,
		items: command.items.map((item) => ({
			...item,
			assigneeIds: unique(item.assigneeIds).sort(),
			labels: unique(item.labels.map((label) => label.trim())).sort((a, b) =>
				a.localeCompare(b, undefined, { sensitivity: "base" }),
			),
			attachmentNames: unique(item.attachmentNames.map((name) => name.trim())),
		})),
	};
}

async function sha256(value: unknown): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(JSON.stringify(value)),
	);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const uuidArray = (ids: string[]) =>
	sql`ARRAY[${sql.join(
		ids.map((id) => sql`${id}`),
		sql`, `,
	)}]::uuid[]`;

function hierarchy(command: Command): {
	depth: Map<string, number>;
	errors: ImportErrorItem[];
} {
	const byKey = new Map(command.items.map((item) => [item.sourceKey, item]));
	const errors: ImportErrorItem[] = [];
	if (byKey.size !== command.items.length) {
		const seen = new Set<string>();
		for (const item of command.items) {
			if (seen.has(item.sourceKey))
				errors.push({ sourceKey: item.sourceKey, field: "sourceKey", code: "duplicate_source_key" });
			seen.add(item.sourceKey);
		}
	}
	for (const item of command.items) {
		if (item.parentSourceKey && !byKey.has(item.parentSourceKey))
			errors.push({ sourceKey: item.sourceKey, field: "parentSourceKey", code: "parent_missing" });
		if (item.parentSourceKey === item.sourceKey)
			errors.push({ sourceKey: item.sourceKey, field: "parentSourceKey", code: "parent_self" });
	}
	const depth = new Map<string, number>();
	const visiting = new Set<string>();
	const resolveDepth = (item: CommandItem): number => {
		const known = depth.get(item.sourceKey);
		if (known !== undefined) return known;
		if (visiting.has(item.sourceKey)) {
			errors.push({ sourceKey: item.sourceKey, field: "parentSourceKey", code: "parent_cycle" });
			return 3;
		}
		visiting.add(item.sourceKey);
		const parent = item.parentSourceKey ? byKey.get(item.parentSourceKey) : undefined;
		const value = parent ? resolveDepth(parent) + 1 : 0;
		visiting.delete(item.sourceKey);
		depth.set(item.sourceKey, value);
		if (value > 2)
			errors.push({ sourceKey: item.sourceKey, field: "parentSourceKey", code: "max_depth_3" });
		return value;
	};
	for (const item of command.items) resolveDepth(item);
	return { depth, errors };
}

async function validateCommand(tx: Tx, command: Command, userId: string) {
	const access = await projectAccess(tx, command.projectId, userId);
	const tree = hierarchy(command);
	const errors = [...tree.errors];
	const assigneeIds = unique(command.items.flatMap((item) => item.assigneeIds));
	if (assigneeIds.length > 0) {
		const memberRows = (await tx.execute(sql`
			SELECT user_id FROM project_members
			WHERE project_id = ${command.projectId} AND user_id = ANY(${uuidArray(assigneeIds)})
		`)) as unknown as { user_id: string }[];
		const members = new Set(memberRows.map((row) => row.user_id));
		for (const item of command.items)
			for (const assigneeId of item.assigneeIds)
				if (!members.has(assigneeId))
					errors.push({ sourceKey: item.sourceKey, field: "assigneeIds", code: "assignee_not_member" });
	}
	const statusRows = await tx
		.select({ id: statuses.id, isDone: statuses.isDone, position: statuses.position })
		.from(statuses)
		.where(sql`${statuses.projectId} = ${command.projectId}`)
		.orderBy(statuses.position);
	const openStatusId = statusRows.find((status) => !status.isDone)?.id ?? statusRows[0]?.id ?? null;
	const doneStatusId = statusRows.find((status) => status.isDone)?.id ?? null;
	if (!openStatusId)
		errors.push({ sourceKey: "*", field: "projectId", code: "project_has_no_status" });
	if (command.items.some((item) => item.completed) && !doneStatusId)
		errors.push({ sourceKey: "*", field: "completed", code: "project_has_no_done_status" });
	const summary = {
		items: command.items.length,
		completed: command.items.filter((item) => item.completed).length,
		sections: unique(command.items.flatMap((item) => (item.sectionName ? [item.sectionName] : []))).length,
		labels: unique(command.items.flatMap((item) => item.labels.map((label) => label.toLocaleLowerCase()))).length,
		assignees: assigneeIds.length,
		attachments: command.items.reduce((sum, item) => sum + item.attachmentNames.length, 0),
	};
	return { access, depth: tree.depth, errors, summary, openStatusId, doneStatusId };
}

function chunks<T>(values: T[], size = 200): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
	return result;
}

function serializeBatch(batch: Record<string, unknown>) {
	return {
		id: batch.id,
		projectId: batch.project_id,
		source: batch.source,
		sourceName: batch.source_name,
		status: batch.status,
		itemCount: Number(batch.item_count),
		attachmentExpected: Number(batch.attachment_expected),
		attachmentRegistered: Number(batch.attachment_registered ?? 0),
		importedAt: batch.imported_at,
		rolledBackAt: batch.rolled_back_at,
		updatedAt: batch.updated_at,
	};
}

/** Přesný výběr cílů pro wizard — UI tak nenabízí projekt, který server později odmítne. */
importRoutes.get("/api/imports/projects", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const rows = (await getDb().execute(sql`
		SELECT project.id, project.name, project.workspace_id, member.role::text AS role
		FROM project_members member
		JOIN projects project ON project.id = member.project_id
		JOIN workspaces workspace ON workspace.id = project.workspace_id
		LEFT JOIN memberships workspace_member
		  ON workspace_member.workspace_id = project.workspace_id
		 AND workspace_member.user_id = ${session.user.id}
		WHERE member.user_id = ${session.user.id}
		  AND (
			workspace.owner_id = ${session.user.id}
			OR project.owner_id = ${session.user.id}
			OR workspace_member.role = 'admin'
			OR member.role IN ('manager', 'editor')
		  )
		ORDER BY lower(project.name), project.id
	`)) as unknown as { id: string; name: string; workspace_id: string; role: string }[];
	return c.json({
		projects: rows.map((row) => ({
			id: row.id,
			name: row.name,
			workspaceId: row.workspace_id,
			role: row.role,
		})),
	});
});

importRoutes.post("/api/imports/preview", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = commandSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_import", issues: parsed.error.issues }, 422);
	try {
		const command = normalizedCommand(parsed.data);
		const validation = await getDb().transaction((tx) => validateCommand(tx, command, session.user.id));
		return c.json({
			valid: validation.errors.length === 0,
			errors: validation.errors,
			summary: validation.summary,
		});
	} catch (error) {
		if (error instanceof ImportApiError)
			return c.json({ error: error.code, detail: error.detail }, error.status);
		throw error;
	}
});

importRoutes.post("/api/imports/execute", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = commandSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_import", issues: parsed.error.issues }, 422);
	const command = normalizedCommand(parsed.data);
	const requestHash = await sha256(command);

	try {
		const result = await getDb().transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`import-id:${command.importId}`}, 0))`,
			);
			const existingRows = (await tx.execute(sql`
				SELECT * FROM import_batches WHERE id = ${command.importId} LIMIT 1
			`)) as unknown as Record<string, unknown>[];
			const existing = existingRows[0];
			if (existing) {
				if (existing.request_hash !== requestHash)
					throw new ImportApiError("import_id_conflict", 409);
				const mappings = await tx
					.select({ id: importItems.id, sourceKey: importItems.sourceKey, taskId: importItems.taskId })
					.from(importItems)
					.where(sql`${importItems.batchId} = ${command.importId}`);
				return { batch: serializeBatch(existing), items: mappings, replayed: true };
			}
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`import-source:${command.projectId}:${command.sourceFingerprint}`}, 0))`,
			);
			const duplicateRows = (await tx.execute(sql`
				SELECT id FROM import_batches
				WHERE project_id = ${command.projectId}
				  AND source_fingerprint = ${command.sourceFingerprint}
				  AND rolled_back_at IS NULL
				LIMIT 1
			`)) as unknown as { id: string }[];
			if (duplicateRows[0])
				throw new ImportApiError("source_already_imported", 409, { importId: duplicateRows[0].id });

			const validation = await validateCommand(tx, command, session.user.id);
			if (validation.errors.length > 0)
				return { invalid: true as const, errors: validation.errors, summary: validation.summary };
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtextextended(${`import-shared:${validation.access.workspace_id}`}, 0))`,
			);

			const existingSections = (await tx.execute(sql`
				SELECT id, name FROM sections WHERE project_id = ${command.projectId}
			`)) as unknown as { id: string; name: string }[];
			const sectionByName = new Map(existingSections.map((row) => [row.name.toLocaleLowerCase(), row.id]));
			const createdSectionIds: string[] = [];
			let sectionPosition = existingSections.length;
			for (const name of unique(command.items.flatMap((item) => (item.sectionName ? [item.sectionName] : [])))) {
				const key = name.toLocaleLowerCase();
				if (sectionByName.has(key)) continue;
				const [created] = await tx
					.insert(sections)
					.values({ projectId: command.projectId, name, position: sectionPosition++ })
					.returning({ id: sections.id });
				if (!created) throw new Error("import_section_create_failed");
				sectionByName.set(key, created.id);
				createdSectionIds.push(created.id);
			}

			const existingLabels = (await tx.execute(sql`
				SELECT id, name FROM labels WHERE workspace_id = ${validation.access.workspace_id}
			`)) as unknown as { id: string; name: string }[];
			const labelByName = new Map(existingLabels.map((row) => [row.name.toLocaleLowerCase(), row.id]));
			const createdLabelIds: string[] = [];
			for (const name of unique(command.items.flatMap((item) => item.labels))) {
				const key = name.toLocaleLowerCase();
				if (labelByName.has(key)) continue;
				const [created] = await tx
					.insert(labels)
					.values({ workspaceId: validation.access.workspace_id, name, isInternal: true })
					.returning({ id: labels.id });
				if (!created) throw new Error("import_label_create_failed");
				labelByName.set(key, created.id);
				createdLabelIds.push(created.id);
			}

			const importedAt = new Date();
			const attachmentExpected = validation.summary.attachments;
			await tx.insert(importBatches).values({
				id: command.importId,
				workspaceId: validation.access.workspace_id,
				projectId: command.projectId,
				createdBy: session.user.id,
				source: command.source,
				sourceName: command.sourceName,
				sourceFingerprint: command.sourceFingerprint,
				requestHash,
				itemCount: command.items.length,
				attachmentExpected,
				createdSectionIds,
				createdLabelIds,
				importedAt,
				createdAt: importedAt,
				updatedAt: importedAt,
			});

			const taskIdBySource = new Map(command.items.map((item) => [item.sourceKey, crypto.randomUUID()]));
			for (const depth of [0, 1, 2]) {
				const values = command.items
					.filter((item) => validation.depth.get(item.sourceKey) === depth)
					.map((item) => ({
						id: taskIdBySource.get(item.sourceKey),
						projectId: command.projectId,
						sectionId: item.sectionName
							? (sectionByName.get(item.sectionName.toLocaleLowerCase()) ?? null)
							: null,
						parentId: item.parentSourceKey ? (taskIdBySource.get(item.parentSourceKey) ?? null) : null,
						name: item.name,
						description: item.description,
						priority: item.priority,
						dueDate: item.dueDate ? new Date(`${item.dueDate}T00:00:00.000Z`) : null,
						assignmentMode:
							item.assigneeIds.length > 1 ? ("shared_any" as const) : ("single" as const),
						statusId: item.completed ? validation.doneStatusId : validation.openStatusId,
						createdBy: session.user.id,
						completedAt: item.completed ? importedAt : null,
						createdAt: importedAt,
						updatedAt: importedAt,
					}));
				for (const group of chunks(values)) if (group.length > 0) await tx.insert(tasks).values(group);
			}

			const assignmentValues = command.items.flatMap((item) =>
				item.assigneeIds.map((userId) => ({
					taskId: taskIdBySource.get(item.sourceKey) as string,
					projectId: command.projectId,
					userId,
					completedAt: item.completed ? importedAt : null,
					createdAt: importedAt,
				})),
			);
			for (const group of chunks(assignmentValues)) if (group.length > 0) await tx.insert(assignments).values(group);

			const taskLabelValues = command.items.flatMap((item) =>
				item.labels.flatMap((name) => {
					const labelId = labelByName.get(name.toLocaleLowerCase());
					return labelId ? [{ taskId: taskIdBySource.get(item.sourceKey) as string, labelId }] : [];
				}),
			);
			for (const group of chunks(taskLabelValues)) if (group.length > 0) await tx.insert(taskLabels).values(group);

			const itemValues = command.items.map((item) => ({
				id: crypto.randomUUID(),
				batchId: command.importId,
				projectId: command.projectId,
				sourceKey: item.sourceKey,
				taskId: taskIdBySource.get(item.sourceKey) as string,
				taskName: item.name,
				assigneeIds: item.assigneeIds,
				labelIds: item.labels.flatMap((name) => {
					const labelId = labelByName.get(name.toLocaleLowerCase());
					return labelId ? [labelId] : [];
				}),
				attachmentExpected: item.attachmentNames.length,
				taskUpdatedAt: importedAt,
				createdAt: importedAt,
			}));
			for (const group of chunks(itemValues)) await tx.insert(importItems).values(group);

			const auditValues = command.items.map((item) => ({
				workspaceId: validation.access.workspace_id,
				actorUserId: session.user.id,
				entity: "tasks",
				entityId: taskIdBySource.get(item.sourceKey) as string,
				action: "import_create",
				diff: {
					project_id: command.projectId,
					import_id: command.importId,
					source: command.source,
					has_description: Boolean(item.description),
					assignee_count: item.assigneeIds.length,
					label_count: item.labels.length,
					attachment_expected: item.attachmentNames.length,
				},
				requestId: c.get("requestId"),
			}));
			for (const group of chunks(auditValues, 100)) await tx.insert(auditEvents).values(group);
			await tx.insert(auditEvents).values({
				workspaceId: validation.access.workspace_id,
				actorUserId: session.user.id,
				entity: "import_batches",
				entityId: command.importId,
				action: "execute",
				diff: { project_id: command.projectId, source: command.source, ...validation.summary },
				requestId: c.get("requestId"),
			});

			return {
				batch: {
					id: command.importId,
					projectId: command.projectId,
					source: command.source,
					sourceName: command.sourceName,
					status: "imported",
					itemCount: command.items.length,
					attachmentExpected,
					attachmentRegistered: 0,
					importedAt: importedAt.toISOString(),
					rolledBackAt: null,
					updatedAt: importedAt.toISOString(),
				},
				items: itemValues.map((item) => ({ id: item.id, sourceKey: item.sourceKey, taskId: item.taskId })),
				replayed: false,
			};
		});
		if ("invalid" in result) return c.json({ error: "import_validation_failed", ...result }, 422);
		return c.json(result, result.replayed ? 200 : 201);
	} catch (error) {
		if (error instanceof ImportApiError)
			return c.json({ error: error.code, detail: error.detail }, error.status);
		throw error;
	}
});

importRoutes.get("/api/projects/:id/imports", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const projectId = uuid.safeParse(c.req.param("id"));
	if (!projectId.success) return c.json({ error: "invalid_project_id" }, 422);
	try {
		const rows = await getDb().transaction(async (tx) => {
			await projectAccess(tx, projectId.data, session.user.id);
			return (await tx.execute(sql`
				SELECT batch.*,
				       (SELECT count(*)::int FROM import_attachments attachment WHERE attachment.batch_id = batch.id)
				         AS attachment_registered
				FROM import_batches batch
				WHERE batch.project_id = ${projectId.data}
				ORDER BY batch.imported_at DESC, batch.id DESC
				LIMIT 100
			`)) as unknown as Record<string, unknown>[];
		});
		return c.json({ imports: rows.map(serializeBatch) });
	} catch (error) {
		if (error instanceof ImportApiError) return c.json({ error: error.code }, error.status);
		throw error;
	}
});

importRoutes.post("/api/imports/:id/register-attachment", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const batchId = uuid.safeParse(c.req.param("id"));
	const parsed = registerAttachmentSchema.safeParse(await c.req.json().catch(() => null));
	if (!batchId.success || !parsed.success) return c.json({ error: "invalid_import_attachment" }, 422);
	try {
		const result = await getDb().transaction(async (tx) => {
			const rows = (await tx.execute(sql`
				SELECT batch.project_id, batch.created_by, batch.status, item.task_id,
				       item.attachment_expected, attachment.task_id AS attachment_task_id,
				       attachment.uploaded_by
				FROM import_batches batch
				JOIN import_items item ON item.batch_id = batch.id AND item.id = ${parsed.data.itemId}
				JOIN attachments attachment ON attachment.id = ${parsed.data.attachmentId}
				WHERE batch.id = ${batchId.data}
				FOR UPDATE OF batch
			`)) as unknown as {
				project_id: string;
				created_by: string | null;
				status: string;
				task_id: string | null;
				attachment_expected: number;
				attachment_task_id: string;
				uploaded_by: string | null;
			}[];
			const row = rows[0];
			if (!row) throw new ImportApiError("import_attachment_not_found", 404);
			await projectAccess(tx, row.project_id, session.user.id);
			if (row.created_by !== session.user.id || row.uploaded_by !== session.user.id)
				throw new ImportApiError("import_attachment_forbidden", 403);
			if (row.status !== "imported" || !row.task_id || row.task_id !== row.attachment_task_id)
				throw new ImportApiError("import_attachment_conflict", 409);
			const prior = (await tx.execute(sql`
				SELECT id FROM import_attachments WHERE attachment_id = ${parsed.data.attachmentId} LIMIT 1
			`)) as unknown as { id: string }[];
			if (prior[0]) return { ok: true, replayed: true };
			const counts = (await tx.execute(sql`
				SELECT count(*)::int AS count FROM import_attachments WHERE item_id = ${parsed.data.itemId}
			`)) as unknown as { count: number }[];
			if ((counts[0]?.count ?? 0) >= row.attachment_expected)
				throw new ImportApiError("import_attachment_limit", 409);
			await tx.insert(importAttachments).values({
				batchId: batchId.data,
				itemId: parsed.data.itemId,
				attachmentId: parsed.data.attachmentId,
			});
			return { ok: true, replayed: false };
		});
		return c.json(result);
	} catch (error) {
		if (error instanceof ImportApiError) return c.json({ error: error.code }, error.status);
		throw error;
	}
});

importRoutes.post("/api/imports/:id/rollback", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const batchId = uuid.safeParse(c.req.param("id"));
	const parsed = rollbackSchema.safeParse(await c.req.json().catch(() => null));
	if (!batchId.success || !parsed.success) return c.json({ error: "invalid_import_rollback" }, 422);
	try {
		const result = await getDb().transaction(async (tx) => {
			const rows = (await tx.execute(sql`
				SELECT * FROM import_batches WHERE id = ${batchId.data} FOR UPDATE
			`)) as unknown as Record<string, unknown>[];
			const batch = rows[0];
			if (!batch) throw new ImportApiError("import_not_found", 404);
			const access = await projectAccess(tx, String(batch.project_id), session.user.id);
			if (
				batch.created_by !== session.user.id &&
				access.workspace_owner_id !== session.user.id &&
				access.workspace_role !== "admin" &&
				access.project_role !== "manager"
			)
				throw new ImportApiError("import_rollback_forbidden", 403);
			if (batch.source_name !== parsed.data.confirmSourceName)
				throw new ImportApiError("import_rollback_confirmation", 409);
			if (batch.status === "rolled_back") return { batch: serializeBatch(batch), replayed: true };
			const versionRows = (await tx.execute(sql`
				SELECT 1 FROM import_batches
				WHERE id = ${batchId.data} AND updated_at = ${parsed.data.expectedUpdatedAt}::timestamptz
			`)) as unknown as { "?column?": number }[];
			if (!versionRows[0]) throw new ImportApiError("stale_import", 409);

			const conflictRows = (await tx.execute(sql`
				WITH imported AS (
					SELECT item.*, task.completed_at
					FROM import_items item
					LEFT JOIN tasks task ON task.id = item.task_id
					WHERE item.batch_id = ${batchId.data}
				), imported_ids AS (
					SELECT task_id FROM imported WHERE task_id IS NOT NULL
				)
				SELECT
					(SELECT count(*)::int FROM imported WHERE task_id IS NULL) AS missing_tasks,
					(SELECT count(*)::int FROM imported item JOIN tasks task ON task.id = item.task_id
					 WHERE task.updated_at <> item.task_updated_at) AS changed_tasks,
					(SELECT count(*)::int FROM tasks child
					 WHERE child.parent_id IN (SELECT task_id FROM imported_ids)
					   AND child.id NOT IN (SELECT task_id FROM imported_ids)) AS external_children,
					(SELECT count(*)::int FROM attachments attachment
					 WHERE attachment.task_id IN (SELECT task_id FROM imported_ids)
					   AND NOT EXISTS (
						 SELECT 1 FROM import_attachments registered
						 WHERE registered.batch_id = ${batchId.data} AND registered.attachment_id = attachment.id
					   )) AS unregistered_attachments,
					(SELECT count(*)::int FROM imported item
					 WHERE (
						 SELECT COALESCE(jsonb_agg(a.user_id::text ORDER BY a.user_id::text), '[]'::jsonb)
						 FROM assignments a WHERE a.task_id = item.task_id
					 ) <> (
						 SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb)
						 FROM jsonb_array_elements_text(item.assignee_ids) value
					 ) OR EXISTS (
						 SELECT 1 FROM assignments a WHERE a.task_id = item.task_id
						   AND ((item.completed_at IS NULL) <> (a.completed_at IS NULL))
					 )) AS changed_assignments,
					(SELECT count(*)::int FROM imported item
					 WHERE (
						 SELECT COALESCE(jsonb_agg(tl.label_id::text ORDER BY tl.label_id::text), '[]'::jsonb)
						 FROM task_labels tl WHERE tl.task_id = item.task_id
					 ) <> (
						 SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb)
						 FROM jsonb_array_elements_text(item.label_ids) value
					 )) AS changed_labels,
					(
						(SELECT count(*) FROM comments WHERE task_id IN (SELECT task_id FROM imported_ids)) +
						(SELECT count(*) FROM checklist_items WHERE task_id IN (SELECT task_id FROM imported_ids)) +
						(SELECT count(*) FROM reminders WHERE task_id IN (SELECT task_id FROM imported_ids)) +
						(SELECT count(*) FROM task_activity WHERE task_id IN (SELECT task_id FROM imported_ids)) +
						(SELECT count(*) FROM task_dependencies WHERE blocking_task_id IN (SELECT task_id FROM imported_ids) OR blocked_task_id IN (SELECT task_id FROM imported_ids)) +
						(SELECT count(*) FROM task_custom_field_values WHERE task_id IN (SELECT task_id FROM imported_ids)) +
						(SELECT count(*) FROM task_polls WHERE task_id IN (SELECT task_id FROM imported_ids)) +
						(SELECT count(*) FROM task_occurrence_overrides WHERE task_id IN (SELECT task_id FROM imported_ids)) +
						(SELECT count(*) FROM task_user_colors WHERE task_id IN (SELECT task_id FROM imported_ids)) +
						(SELECT count(*) FROM calendar_links WHERE task_id IN (SELECT task_id FROM imported_ids)) +
						(SELECT count(*) FROM chain_steps WHERE task_id IN (SELECT task_id FROM imported_ids)) +
						(SELECT count(*) FROM project_milestones WHERE task_id IN (SELECT task_id FROM imported_ids)) +
						(SELECT count(*) FROM intake_submissions WHERE task_id IN (SELECT task_id FROM imported_ids)) +
						(SELECT count(*) FROM entity_links WHERE from_id IN (SELECT task_id::text FROM imported_ids) OR to_id IN (SELECT task_id::text FROM imported_ids))
					)::int AS related_changes
			`)) as unknown as Record<string, number>[];
			const conflicts = conflictRows[0] ?? {};
			if (Object.values(conflicts).some((count) => Number(count) > 0))
				throw new ImportApiError("import_rollback_conflict", 409, conflicts);

			const taskRows = (await tx.execute(sql`
				SELECT task_id FROM import_items WHERE batch_id = ${batchId.data} AND task_id IS NOT NULL
			`)) as unknown as { task_id: string }[];
			const taskIds = taskRows.map((row) => row.task_id);
			if (taskIds.length > 0) await tx.execute(sql`DELETE FROM tasks WHERE id = ANY(${uuidArray(taskIds)})`);
			const sectionIds = Array.isArray(batch.created_section_ids)
				? batch.created_section_ids.map(String)
				: [];
			if (sectionIds.length > 0)
				await tx.execute(sql`
					DELETE FROM sections section
					WHERE section.id = ANY(${uuidArray(sectionIds)})
					  AND NOT EXISTS (SELECT 1 FROM tasks task WHERE task.section_id = section.id)
				`);
			const labelIds = Array.isArray(batch.created_label_ids) ? batch.created_label_ids.map(String) : [];
			if (labelIds.length > 0)
				await tx.execute(sql`
					DELETE FROM labels label
					WHERE label.id = ANY(${uuidArray(labelIds)})
					  AND NOT EXISTS (SELECT 1 FROM task_labels task_label WHERE task_label.label_id = label.id)
				`);
			const rolledBackAt = new Date().toISOString();
			const updatedRows = (await tx.execute(sql`
				UPDATE import_batches SET status = 'rolled_back', rolled_back_at = ${rolledBackAt},
				       updated_at = ${rolledBackAt}
				WHERE id = ${batchId.data}
				RETURNING *, 0::int AS attachment_registered
			`)) as unknown as Record<string, unknown>[];
			await tx.insert(auditEvents).values({
				workspaceId: String(batch.workspace_id),
				actorUserId: session.user.id,
				entity: "import_batches",
				entityId: batchId.data,
				action: "rollback",
				diff: { project_id: batch.project_id, task_count: taskIds.length, source: batch.source },
				requestId: c.get("requestId"),
			});
			return { batch: serializeBatch(updatedRows[0] ?? batch), replayed: false };
		});
		return c.json(result);
	} catch (error) {
		if (error instanceof ImportApiError)
			return c.json({ error: error.code, detail: error.detail }, error.status);
		throw error;
	}
});
