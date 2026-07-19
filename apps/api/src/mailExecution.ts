/** F5/M2 — autoritativní převod osobní zprávy na skutečný Watson úkol. */
import { createHash } from "node:crypto";
import {
	and,
	assignments,
	auditEvents,
	eq,
	getDb,
	isNull,
	mailAccounts,
	mailMessages,
	mailTaskLinks,
	projects,
	sql,
	tasks,
	workspaces,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";

export const mailExecutionRoutes = new Hono<{ Variables: { requestId: string } }>();

const uuid = z.string().uuid();
const isoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine((value) => {
		const parsed = new Date(`${value}T00:00:00.000Z`);
		return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
	}, "invalid_date");
const createExecutionTaskSchema = z
	.object({
		operationId: uuid,
		taskId: uuid,
		projectId: uuid,
		name: z.string().trim().min(1).max(500),
		description: z.string().trim().max(20_000).nullable().optional(),
		priority: z.number().int().min(1).max(4),
		dueDate: isoDate.nullable(),
		replaceDeleted: z.boolean().optional().default(false),
	})
	.strict();

type ExecutionSnapshot = {
	linkId: string;
	accountId: string;
	messageId: string;
	providerMessageId: string;
	taskId: string;
	projectId: string;
	taskExists: boolean;
	taskName: string | null;
	priority: number | null;
	completedAt: string | null;
	createdAt: string;
};

type ExecutionQueryRow = {
	linkId: string;
	accountId: string;
	messageId: string;
	providerMessageId: string;
	sourceTaskId: string;
	sourceProjectId: string;
	createdAt: Date;
	liveTaskId: string | null;
	taskName: string | null;
	priority: number | null;
	completedAt: Date | null;
};

const executionSnapshot = (row: ExecutionQueryRow): ExecutionSnapshot => ({
	linkId: row.linkId,
	accountId: row.accountId,
	messageId: row.messageId,
	providerMessageId: row.providerMessageId,
	taskId: row.sourceTaskId,
	projectId: row.sourceProjectId,
	taskExists: row.liveTaskId === row.sourceTaskId,
	taskName: row.taskName,
	priority: row.priority,
	completedAt: row.completedAt?.toISOString() ?? null,
	createdAt: row.createdAt.toISOString(),
});

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

const commandHash = (value: unknown) =>
	createHash("sha256").update(canonicalJson(value)).digest("hex");

const linkSelection = {
	linkId: mailTaskLinks.id,
	accountId: mailTaskLinks.accountId,
	messageId: mailTaskLinks.sourceMessageId,
	providerMessageId: mailTaskLinks.providerMessageId,
	sourceTaskId: mailTaskLinks.sourceTaskId,
	sourceProjectId: mailTaskLinks.sourceProjectId,
	createdAt: mailTaskLinks.createdAt,
	liveTaskId: tasks.id,
	taskName: tasks.name,
	priority: tasks.priority,
	completedAt: tasks.completedAt,
};

mailExecutionRoutes.get("/api/mail/accounts/:accountId/executions", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const accountId = uuid.safeParse(c.req.param("accountId"));
	if (!accountId.success) return c.json({ error: "invalid_account_id" }, 422);
	const account = (
		await getDb()
			.select({ id: mailAccounts.id, workspaceId: mailAccounts.workspaceId })
			.from(mailAccounts)
			.where(
				and(
					eq(mailAccounts.id, accountId.data),
					eq(mailAccounts.ownerUserId, session.user.id),
				),
			)
			.limit(1)
	)[0];
	if (!account) return c.json({ error: "mail_account_not_found" }, 404);
	const [rows, eligibleProjects] = await Promise.all([
		getDb()
			.select(linkSelection)
			.from(mailTaskLinks)
			.leftJoin(tasks, eq(tasks.id, mailTaskLinks.sourceTaskId))
			.where(
				and(
					eq(mailTaskLinks.accountId, account.id),
					eq(mailTaskLinks.ownerUserId, session.user.id),
					isNull(mailTaskLinks.retiredAt),
				),
			)
			.orderBy(mailTaskLinks.createdAt),
		getDb()
			.select({ id: projects.id, name: projects.name, color: projects.color })
			.from(projects)
			.where(
				and(
					eq(projects.workspaceId, account.workspaceId),
					eq(projects.status, "active"),
				),
			)
			.orderBy(projects.createdAt),
	]);
	return c.json({ executions: rows.map(executionSnapshot), projects: eligibleProjects });
});

mailExecutionRoutes.post(
	"/api/mail/accounts/:accountId/messages/:messageId/execution-task",
	async (c) => {
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		if (!session) return c.json({ error: "unauthorized" }, 401);
		const ids = z
			.object({ accountId: uuid, messageId: uuid })
			.safeParse(c.req.param());
		const parsed = createExecutionTaskSchema.safeParse(await c.req.json().catch(() => null));
		if (!ids.success || !parsed.success)
			return c.json({ error: "invalid_mail_execution_task" }, 422);
		const hash = commandHash(parsed.data);

		try {
			const result = await getDb().transaction(async (tx) => {
				await tx.execute(
					sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mail-execution:${session.user.id}:${parsed.data.operationId}`}, 0))`,
				);
				const replay = (
					await tx
						.select({ ...linkSelection, requestHash: mailTaskLinks.requestHash })
						.from(mailTaskLinks)
						.leftJoin(tasks, eq(tasks.id, mailTaskLinks.sourceTaskId))
						.where(
							and(
								eq(mailTaskLinks.ownerUserId, session.user.id),
								eq(mailTaskLinks.operationId, parsed.data.operationId),
							),
						)
						.limit(1)
				)[0];
				if (replay) {
					if (replay.requestHash !== hash) return { operationConflict: true as const };
					return { execution: executionSnapshot(replay), replayed: true as const };
				}

				await tx.execute(
					sql`SELECT id FROM mail_messages WHERE id = ${ids.data.messageId} FOR UPDATE`,
				);
				const account = (
					await tx
						.select({
							id: mailAccounts.id,
							workspaceId: mailAccounts.workspaceId,
							ownerUserId: mailAccounts.ownerUserId,
							workspaceOwnerId: workspaces.ownerId,
							isPersonal: workspaces.isPersonal,
						})
						.from(mailAccounts)
						.innerJoin(workspaces, eq(workspaces.id, mailAccounts.workspaceId))
						.where(
							and(
								eq(mailAccounts.id, ids.data.accountId),
								eq(mailAccounts.ownerUserId, session.user.id),
							),
						)
						.limit(1)
				)[0];
				if (!account?.isPersonal || account.workspaceOwnerId !== session.user.id)
					return { accountMissing: true as const };
				const message = (
					await tx
						.select({
							id: mailMessages.id,
							providerMessageId: mailMessages.providerMessageId,
						})
						.from(mailMessages)
						.where(
							and(
								eq(mailMessages.id, ids.data.messageId),
								eq(mailMessages.accountId, account.id),
							),
						)
						.limit(1)
				)[0];
				if (!message) return { messageMissing: true as const };

				const active = (
					await tx
						.select(linkSelection)
						.from(mailTaskLinks)
						.leftJoin(tasks, eq(tasks.id, mailTaskLinks.sourceTaskId))
						.where(
							and(
								eq(mailTaskLinks.accountId, account.id),
								eq(mailTaskLinks.providerMessageId, message.providerMessageId),
								isNull(mailTaskLinks.retiredAt),
							),
						)
						.limit(1)
				)[0];
				if (active?.liveTaskId) {
					return { alreadyLinked: executionSnapshot(active) };
				}
				if (active && !parsed.data.replaceDeleted) {
					return { deletedTask: executionSnapshot(active) };
				}

				const project = (
					await tx
						.select({ id: projects.id, status: projects.status })
						.from(projects)
						.where(
							and(
								eq(projects.id, parsed.data.projectId),
								eq(projects.workspaceId, account.workspaceId),
							),
						)
						.limit(1)
				)[0];
				if (project?.status !== "active")
					return { invalidProject: true as const };
				const reusedTask = (
					await tx
						.select({ id: tasks.id })
						.from(tasks)
						.where(eq(tasks.id, parsed.data.taskId))
						.limit(1)
				)[0];
				if (reusedTask) return { taskConflict: true as const };

				if (active) {
					await tx
						.update(mailTaskLinks)
						.set({ retiredAt: new Date(), retiredReason: "task_missing", updatedAt: new Date() })
						.where(
							and(eq(mailTaskLinks.id, active.linkId), isNull(mailTaskLinks.retiredAt)),
						);
				}
				await tx.insert(tasks).values({
					id: parsed.data.taskId,
					projectId: project.id,
					name: parsed.data.name,
					description: parsed.data.description || null,
					priority: parsed.data.priority,
					dueDate: parsed.data.dueDate
						? new Date(`${parsed.data.dueDate}T00:00:00.000Z`)
						: null,
					assignmentMode: "single",
					mailTh: `personal:${account.id}:${message.id}`,
					mailLabel: parsed.data.name.slice(0, 300),
					createdBy: session.user.id,
				});
				await tx.insert(assignments).values({
					taskId: parsed.data.taskId,
					projectId: project.id,
					userId: session.user.id,
				});
				const [link] = await tx
					.insert(mailTaskLinks)
					.values({
						workspaceId: account.workspaceId,
						accountId: account.id,
						ownerUserId: session.user.id,
						sourceMessageId: message.id,
						providerMessageId: message.providerMessageId,
						sourceTaskId: parsed.data.taskId,
						sourceProjectId: project.id,
						operationId: parsed.data.operationId,
						requestHash: hash,
					})
					.returning();
				if (!link) throw new Error("mail_execution_link_missing");
				await tx.insert(auditEvents).values({
					workspaceId: account.workspaceId,
					actorType: "user",
					actorUserId: session.user.id,
					entity: "tasks",
					entityId: parsed.data.taskId,
					action: active ? "replace_from_mail" : "create_from_mail",
					diff: {
						linkId: link.id,
						accountId: account.id,
						messageId: message.id,
						projectId: project.id,
						priority: parsed.data.priority,
						dueDateSet: Boolean(parsed.data.dueDate),
						operationId: parsed.data.operationId,
						commandHash: hash,
					},
					requestId: c.get("requestId") ?? null,
				});
				return {
					execution: executionSnapshot({
						linkId: link.id,
						accountId: account.id,
						messageId: message.id,
						providerMessageId: message.providerMessageId,
						sourceTaskId: parsed.data.taskId,
						sourceProjectId: project.id,
						createdAt: link.createdAt,
						liveTaskId: parsed.data.taskId,
						taskName: parsed.data.name,
						priority: parsed.data.priority,
						completedAt: null,
					}),
					replayed: false as const,
				};
			});

			if ("operationConflict" in result)
				return c.json({ error: "operation_id_reused" }, 409);
			if ("accountMissing" in result)
				return c.json({ error: "mail_account_not_found" }, 404);
			if ("messageMissing" in result)
				return c.json({ error: "mail_message_not_found" }, 404);
			if ("invalidProject" in result)
				return c.json({ error: "mail_execution_personal_project_required" }, 422);
			if ("taskConflict" in result)
				return c.json({ error: "mail_execution_task_id_reused" }, 409);
			if ("alreadyLinked" in result)
				return c.json(
					{ error: "mail_message_already_linked", execution: result.alreadyLinked },
					409,
				);
			if ("deletedTask" in result)
				return c.json(
					{ error: "mail_execution_task_deleted", execution: result.deletedTask },
					409,
				);
			return c.json(result, result.replayed ? 200 : 201);
		} catch (error) {
			if ((error as { code?: string }).code === "23505")
				return c.json({ error: "mail_execution_conflict" }, 409);
			throw error;
		}
	},
);
