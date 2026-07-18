/** Explicit, encrypted shared drafts with CAS editing and human approval. */
import { createHash } from "node:crypto";
import {
	and,
	auditEvents,
	desc,
	eq,
	getDb,
	inArray,
	mailAccounts,
	mailOutboundMessages,
	mailSharedDraftApprovals,
	mailSharedDraftMembers,
	mailSharedDrafts,
	memberships,
	sql,
	users,
	workspaces,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";
import { decryptMailContent, encryptMailContent } from "./mailContentVault";
import type { MailVaultEnvelope } from "./mailVault";

export const mailSharedDraftRoutes = new Hono<{ Variables: { requestId: string } }>();
const UNDO_WINDOW_MS = 10_000;
const email = z.string().trim().toLowerCase().email().max(320);
const recipients = z.array(email).max(50).default([]);
const draftContentSchema = z.object({
	to: z.array(email).min(1).max(50),
	cc: recipients,
	bcc: recipients,
	subject: z.string().trim().max(998).refine((value) => !/[\r\n]/.test(value), "invalid_subject"),
	textBody: z.string().max(512 * 1024),
}).strict().refine((value) => value.subject.length > 0 || value.textBody.trim().length > 0, "empty_message");

function envelopeFrom(row: { algorithm: string; keyId: string; nonce: string; authTag: string; ciphertext: string }): MailVaultEnvelope {
	if (row.algorithm !== "aes-256-gcm-v1") throw new Error("mail_content_algorithm_unsupported");
	return { algorithm: "aes-256-gcm-v1", keyId: row.keyId, nonce: row.nonce, authTag: row.authTag, ciphertext: row.ciphertext };
}

function draftContext(row: Pick<typeof mailSharedDrafts.$inferSelect, "id" | "accountId">) {
	return { accountId: row.accountId, provider: "google" as const, providerMessageId: `draft:${row.id}` };
}

function decryptDraft(row: typeof mailSharedDrafts.$inferSelect) {
	return draftContentSchema.parse(decryptMailContent(draftContext(row), envelopeFrom(row)));
}

function sha256(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

function sqlState(error: unknown): string | undefined {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
		const value = current as { code?: string; cause?: unknown };
		if (value.code) return value.code;
		current = value.cause;
	}
	return undefined;
}

async function accessToDraft(draftId: string, userId: string) {
	const draft = (await getDb().select().from(mailSharedDrafts).where(eq(mailSharedDrafts.id, draftId)).limit(1))[0];
	if (!draft) return null;
	if (draft.ownerUserId === userId) return { draft, role: "owner" as const };
	const member = (await getDb().select({ role: mailSharedDraftMembers.role }).from(mailSharedDraftMembers).where(and(
		eq(mailSharedDraftMembers.draftId, draftId),
		eq(mailSharedDraftMembers.userId, userId),
	)).limit(1))[0];
	return member ? { draft, role: member.role as "editor" | "approver" } : null;
}

async function publicDraft(row: typeof mailSharedDrafts.$inferSelect, viewerUserId: string) {
	const [memberRows, approvalRows, outboundRows] = await Promise.all([
		getDb().select({
			userId: mailSharedDraftMembers.userId,
			role: mailSharedDraftMembers.role,
			name: users.name,
			email: users.email,
		}).from(mailSharedDraftMembers).innerJoin(users, eq(users.id, mailSharedDraftMembers.userId))
			.where(eq(mailSharedDraftMembers.draftId, row.id)),
		getDb().select({
			approverUserId: mailSharedDraftApprovals.approverUserId,
			status: mailSharedDraftApprovals.status,
			decidedAt: mailSharedDraftApprovals.decidedAt,
			decidedContentVersion: mailSharedDraftApprovals.decidedContentVersion,
			name: users.name,
		}).from(mailSharedDraftApprovals).innerJoin(users, eq(users.id, mailSharedDraftApprovals.approverUserId))
			.where(eq(mailSharedDraftApprovals.draftId, row.id)),
		row.outboundId ? getDb().select({ status: mailOutboundMessages.status }).from(mailOutboundMessages)
			.where(eq(mailOutboundMessages.id, row.outboundId)).limit(1) : Promise.resolve([]),
	]);
	let content: z.infer<typeof draftContentSchema> | null = null;
	try { content = decryptDraft(row); } catch { /* unavailable key remains explicit */ }
	const viewerRole = row.ownerUserId === viewerUserId
		? "owner"
		: memberRows.find((member) => member.userId === viewerUserId)?.role ?? null;
	const viewerApproval = approvalRows.find((approval) => approval.approverUserId === viewerUserId);
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		accountId: row.accountId,
		ownerUserId: row.ownerUserId,
		status: row.status,
		requiredApprovals: row.requiredApprovals,
		content,
		contentUnavailable: content === null,
		contentVersion: row.contentVersion,
		version: row.version,
		submittedAt: row.submittedAt?.toISOString() ?? null,
		approvedAt: row.approvedAt?.toISOString() ?? null,
		queuedAt: row.queuedAt?.toISOString() ?? null,
		outboundId: row.outboundId,
		outboundStatus: outboundRows[0]?.status ?? null,
		updatedAt: row.updatedAt.toISOString(),
		viewerRole,
		viewerApproval: viewerApproval ? {
			...viewerApproval,
			decidedAt: viewerApproval.decidedAt?.toISOString() ?? null,
		} : null,
		members: memberRows,
		approvals: approvalRows.map((approval) => ({
			...approval,
			decidedAt: approval.decidedAt?.toISOString() ?? null,
		})),
	};
}

mailSharedDraftRoutes.get("/api/mail/shared-drafts/options", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const teamWorkspaces = await getDb().select({ id: workspaces.id, name: workspaces.name })
		.from(memberships)
		.innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
		.where(and(eq(memberships.userId, session.user.id), eq(workspaces.isPersonal, false)))
		.orderBy(workspaces.name);
	const workspaceIds = teamWorkspaces.map((workspace) => workspace.id);
	const memberRows = workspaceIds.length === 0 ? [] : await getDb().select({
		workspaceId: memberships.workspaceId,
		userId: users.id,
		name: users.name,
		email: users.email,
	}).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
		.where(inArray(memberships.workspaceId, workspaceIds));
	return c.json({
		workspaces: teamWorkspaces.map((workspace) => ({
			...workspace,
			members: memberRows.filter((member) => member.workspaceId === workspace.id && member.userId !== session.user.id),
		})),
	});
});

mailSharedDraftRoutes.get("/api/mail/shared-drafts", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const rows = await getDb().select().from(mailSharedDrafts).where(sql`
		${mailSharedDrafts.ownerUserId} = ${session.user.id}
		OR EXISTS (
			SELECT 1 FROM mail_shared_draft_members dm
			WHERE dm.draft_id = ${mailSharedDrafts.id} AND dm.user_id = ${session.user.id}
		)
	`).orderBy(desc(mailSharedDrafts.updatedAt), desc(mailSharedDrafts.id)).limit(100);
	return c.json({ drafts: await Promise.all(rows.map((row) => publicDraft(row, session.user.id))) });
});

mailSharedDraftRoutes.get("/api/mail/shared-drafts/:draftId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const draftId = z.string().uuid().safeParse(c.req.param("draftId"));
	if (!draftId.success) return c.json({ error: "invalid_mail_shared_draft" }, 422);
	const access = await accessToDraft(draftId.data, session.user.id);
	if (!access) return c.json({ error: "mail_shared_draft_not_found" }, 404);
	return c.json({ draft: await publicDraft(access.draft, session.user.id) });
});

const createSchema = z.object({
	id: z.string().uuid(),
	workspaceId: z.string().uuid(),
	accountId: z.string().uuid(),
	content: draftContentSchema,
	editors: z.array(z.string().uuid()).max(20).default([]),
	approvers: z.array(z.string().uuid()).min(1).max(20),
	requiredApprovals: z.number().int().min(1).max(20).default(1),
}).strict().refine((value) => new Set([...value.editors, ...value.approvers]).size === value.editors.length + value.approvers.length, "duplicate_member")
	.refine((value) => value.requiredApprovals <= value.approvers.length, "insufficient_approvers");

mailSharedDraftRoutes.post("/api/mail/shared-drafts", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const body = createSchema.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: "invalid_mail_shared_draft" }, 422);
	const allMembers = [...body.data.editors, ...body.data.approvers];
	try {
		const row = await getDb().transaction(async (tx) => {
			const account = (await tx.select().from(mailAccounts).where(and(
				eq(mailAccounts.id, body.data.accountId),
				eq(mailAccounts.ownerUserId, session.user.id),
				eq(mailAccounts.provider, "google"),
				sql`${mailAccounts.status} <> 'revoked'`,
			)).limit(1))[0];
			if (!account) throw new Error("mail_account_not_found");
			const workspace = (await tx.select({ id: workspaces.id }).from(workspaces).innerJoin(
				memberships,
				and(eq(memberships.workspaceId, workspaces.id), eq(memberships.userId, session.user.id)),
			).where(and(eq(workspaces.id, body.data.workspaceId), eq(workspaces.isPersonal, false))).limit(1))[0];
			if (!workspace) throw new Error("mail_shared_workspace_forbidden");
			const actualMembers = allMembers.length === 0 ? [] : await tx.select({ userId: memberships.userId }).from(memberships).where(and(
				eq(memberships.workspaceId, body.data.workspaceId),
				inArray(memberships.userId, allMembers),
			));
			if (actualMembers.length !== allMembers.length || allMembers.includes(session.user.id)) {
				throw new Error("mail_shared_draft_member_invalid");
			}
			const envelope = encryptMailContent(
				{ accountId: account.id, provider: "google", providerMessageId: `draft:${body.data.id}` },
				body.data.content,
			);
			const created = (await tx.insert(mailSharedDrafts).values({
				id: body.data.id,
				workspaceId: body.data.workspaceId,
				accountId: account.id,
				ownerUserId: session.user.id,
				createdByUserId: session.user.id,
				requiredApprovals: body.data.requiredApprovals,
				...envelope,
			}).returning())[0];
			if (!created) throw new Error("mail_shared_draft_create_failed");
			if (allMembers.length > 0) await tx.insert(mailSharedDraftMembers).values([
				...body.data.editors.map((userId) => ({ draftId: created.id, userId, role: "editor" })),
				...body.data.approvers.map((userId) => ({ draftId: created.id, userId, role: "approver" })),
			]);
			await tx.insert(mailSharedDraftApprovals).values(body.data.approvers.map((approverUserId) => ({
				draftId: created.id,
				approverUserId,
			})));
			await tx.insert(auditEvents).values({
				workspaceId: created.workspaceId,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "mail_shared_draft",
				entityId: created.id,
				action: "created",
				diff: { accountId: created.accountId, editors: body.data.editors, approvers: body.data.approvers, requiredApprovals: created.requiredApprovals },
				requestId: c.get("requestId") ?? null,
			});
			return created;
		});
		return c.json({ draft: await publicDraft(row, session.user.id) }, 201);
	} catch (error) {
		const code = error instanceof Error ? error.message : "mail_shared_draft_create_failed";
		if (["mail_account_not_found", "mail_shared_workspace_forbidden", "mail_shared_draft_member_invalid"].includes(code)) {
			return c.json({ error: code }, code === "mail_account_not_found" ? 404 : 403);
		}
		if (sqlState(error) === "23505") return c.json({ error: "mail_shared_draft_exists" }, 409);
		throw error;
	}
});

const updateSchema = z.object({
	content: draftContentSchema,
	expectedVersion: z.number().int().positive(),
}).strict();

mailSharedDraftRoutes.put("/api/mail/shared-drafts/:draftId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const draftId = z.string().uuid().safeParse(c.req.param("draftId"));
	const body = updateSchema.safeParse(await c.req.json().catch(() => null));
	if (!draftId.success || !body.success) return c.json({ error: "invalid_mail_shared_draft" }, 422);
	const access = await accessToDraft(draftId.data, session.user.id);
	if (!access) return c.json({ error: "mail_shared_draft_not_found" }, 404);
	if (access.role !== "owner" && access.role !== "editor") return c.json({ error: "forbidden" }, 403);
	if (!["draft", "rejected"].includes(access.draft.status)) return c.json({ error: "mail_shared_draft_content_locked" }, 409);
	const envelope = encryptMailContent(draftContext(access.draft), body.data.content);
	const row = await getDb().transaction(async (tx) => {
		const updated = (await tx.update(mailSharedDrafts).set({
			...envelope,
			status: "draft",
			submittedAt: null,
			approvedAt: null,
			queuedAt: null,
			outboundId: null,
			contentVersion: sql`${mailSharedDrafts.contentVersion} + 1`,
			version: sql`${mailSharedDrafts.version} + 1`,
		}).where(and(
			eq(mailSharedDrafts.id, access.draft.id),
			eq(mailSharedDrafts.version, body.data.expectedVersion),
			sql`${mailSharedDrafts.status} in ('draft', 'rejected')`,
		)).returning())[0];
		if (!updated) return null;
		await tx.update(mailSharedDraftApprovals).set({
			status: "pending", decidedAt: null, decidedContentVersion: null,
		}).where(eq(mailSharedDraftApprovals.draftId, updated.id));
		await tx.insert(auditEvents).values({
			workspaceId: updated.workspaceId,
			actorType: "user",
			actorUserId: session.user.id,
			entity: "mail_shared_draft",
			entityId: updated.id,
			action: "content_updated",
			diff: { contentVersion: updated.contentVersion, approvalReset: access.draft.status === "rejected" },
			requestId: c.get("requestId") ?? null,
		});
		return updated;
	});
	if (!row) return c.json({ error: "mail_shared_draft_conflict" }, 409);
	return c.json({ draft: await publicDraft(row, session.user.id) });
});

const versionSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();

mailSharedDraftRoutes.post("/api/mail/shared-drafts/:draftId/submit", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const draftId = z.string().uuid().safeParse(c.req.param("draftId"));
	const body = versionSchema.safeParse(await c.req.json().catch(() => null));
	if (!draftId.success || !body.success) return c.json({ error: "invalid_mail_shared_draft" }, 422);
	const access = await accessToDraft(draftId.data, session.user.id);
	if (!access) return c.json({ error: "mail_shared_draft_not_found" }, 404);
	if (access.role !== "owner" && access.role !== "editor") return c.json({ error: "forbidden" }, 403);
	const now = new Date();
	const row = (await getDb().update(mailSharedDrafts).set({
		status: "pending_approval",
		submittedAt: now,
		approvedAt: null,
		version: sql`${mailSharedDrafts.version} + 1`,
	}).where(and(
		eq(mailSharedDrafts.id, draftId.data),
		eq(mailSharedDrafts.version, body.data.expectedVersion),
		eq(mailSharedDrafts.status, "draft"),
	)).returning())[0];
	if (!row) return c.json({ error: "mail_shared_draft_conflict" }, 409);
	await getDb().insert(auditEvents).values({
		workspaceId: row.workspaceId, actorType: "user", actorUserId: session.user.id,
		entity: "mail_shared_draft", entityId: row.id, action: "submitted_for_approval",
		diff: { contentVersion: row.contentVersion, requiredApprovals: row.requiredApprovals }, requestId: c.get("requestId") ?? null,
	});
	return c.json({ draft: await publicDraft(row, session.user.id) });
});

mailSharedDraftRoutes.post("/api/mail/shared-drafts/:draftId/cancel", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const draftId = z.string().uuid().safeParse(c.req.param("draftId"));
	const body = versionSchema.safeParse(await c.req.json().catch(() => null));
	if (!draftId.success || !body.success) return c.json({ error: "invalid_mail_shared_draft" }, 422);
	const row = (await getDb().update(mailSharedDrafts).set({
		status: "cancelled",
		version: sql`${mailSharedDrafts.version} + 1`,
	}).where(and(
		eq(mailSharedDrafts.id, draftId.data),
		eq(mailSharedDrafts.ownerUserId, session.user.id),
		eq(mailSharedDrafts.version, body.data.expectedVersion),
		sql`${mailSharedDrafts.status} in ('draft', 'pending_approval', 'approved', 'rejected')`,
	)).returning())[0];
	if (!row) {
		const access = await accessToDraft(draftId.data, session.user.id);
		if (access?.role !== "owner") return c.json({ error: "mail_shared_draft_not_found" }, 404);
		return c.json({ error: "mail_shared_draft_conflict" }, 409);
	}
	await getDb().insert(auditEvents).values({
		workspaceId: row.workspaceId, actorType: "user", actorUserId: session.user.id,
		entity: "mail_shared_draft", entityId: row.id, action: "cancelled",
		diff: { previousContentVersion: row.contentVersion }, requestId: c.get("requestId") ?? null,
	});
	return c.json({ draft: await publicDraft(row, session.user.id) });
});

const decisionSchema = z.object({
	decision: z.enum(["approved", "rejected"]),
	expectedVersion: z.number().int().positive(),
}).strict();

mailSharedDraftRoutes.post("/api/mail/shared-drafts/:draftId/decision", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const draftId = z.string().uuid().safeParse(c.req.param("draftId"));
	const body = decisionSchema.safeParse(await c.req.json().catch(() => null));
	if (!draftId.success || !body.success) return c.json({ error: "invalid_mail_shared_draft_decision" }, 422);
	const result = await getDb().transaction(async (tx) => {
		const locked = (await tx.execute(sql`
			SELECT * FROM mail_shared_drafts
			WHERE id = ${draftId.data} FOR UPDATE
		`)) as unknown as Array<{ id: string; workspace_id: string; status: string; version: number; content_version: number; required_approvals: number }>;
		const draft = locked[0];
		if (!draft) return { error: "mail_shared_draft_not_found" as const };
		if (draft.version !== body.data.expectedVersion || draft.status !== "pending_approval") return { error: "mail_shared_draft_conflict" as const };
		const approval = (await tx.update(mailSharedDraftApprovals).set({
			status: body.data.decision,
			decidedAt: new Date(),
			decidedContentVersion: draft.content_version,
		}).where(and(
			eq(mailSharedDraftApprovals.draftId, draft.id),
			eq(mailSharedDraftApprovals.approverUserId, session.user.id),
			eq(mailSharedDraftApprovals.status, "pending"),
		)).returning())[0];
		if (!approval) return { error: "forbidden" as const };
		const approvedRows = await tx.select({ count: sql<number>`count(*)::int` }).from(mailSharedDraftApprovals).where(and(
			eq(mailSharedDraftApprovals.draftId, draft.id),
			eq(mailSharedDraftApprovals.status, "approved"),
			eq(mailSharedDraftApprovals.decidedContentVersion, draft.content_version),
		));
		const nextStatus = body.data.decision === "rejected"
			? "rejected"
			: (approvedRows[0]?.count ?? 0) >= draft.required_approvals ? "approved" : "pending_approval";
		const updated = (await tx.update(mailSharedDrafts).set({
			status: nextStatus,
			approvedAt: nextStatus === "approved" ? new Date() : null,
			version: sql`${mailSharedDrafts.version} + 1`,
		}).where(and(eq(mailSharedDrafts.id, draft.id), eq(mailSharedDrafts.version, draft.version))).returning())[0];
		if (!updated) return { error: "mail_shared_draft_conflict" as const };
		await tx.insert(auditEvents).values({
			workspaceId: draft.workspace_id, actorType: "user", actorUserId: session.user.id,
			entity: "mail_shared_draft", entityId: draft.id, action: body.data.decision,
			diff: { contentVersion: draft.content_version, resultingStatus: nextStatus }, requestId: c.get("requestId") ?? null,
		});
		return { row: updated };
	});
	if ("error" in result && result.error) return c.json({ error: result.error }, result.error === "forbidden" ? 403 : result.error.endsWith("not_found") ? 404 : 409);
	return c.json({ draft: await publicDraft(result.row, session.user.id) });
});

const sendSchema = z.object({
	expectedVersion: z.number().int().positive(),
	outboundId: z.string().uuid(),
	operationId: z.string().uuid(),
}).strict();

mailSharedDraftRoutes.post("/api/mail/shared-drafts/:draftId/send", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const draftId = z.string().uuid().safeParse(c.req.param("draftId"));
	const body = sendSchema.safeParse(await c.req.json().catch(() => null));
	if (!draftId.success || !body.success) return c.json({ error: "invalid_mail_shared_draft_send" }, 422);
	const result = await getDb().transaction(async (tx) => {
		const rows = (await tx.execute(sql`
			SELECT d.*, a.status AS account_status, a.provider, a.workspace_id AS account_workspace_id
			FROM mail_shared_drafts d JOIN mail_accounts a ON a.id = d.account_id
			WHERE d.id = ${draftId.data} FOR UPDATE OF d, a
		`)) as unknown as Array<{
			id: string; workspace_id: string; account_id: string; owner_user_id: string; status: string;
			version: number; content_version: number; algorithm: string; key_id: string; nonce: string;
			auth_tag: string; ciphertext: string; outbound_id: string | null; account_status: string; provider: string;
			account_workspace_id: string;
		}>;
		const row = rows[0];
		if (!row || row.owner_user_id !== session.user.id) return { error: "mail_shared_draft_not_found" as const };
		if (row.status === "queued" && row.outbound_id === body.data.outboundId) {
			const draft = (await tx.select().from(mailSharedDrafts).where(eq(mailSharedDrafts.id, row.id)).limit(1))[0];
			return draft ? { row: draft, replayed: true } : { error: "mail_shared_draft_not_found" as const };
		}
		if (row.status !== "approved" || row.version !== body.data.expectedVersion) return { error: "mail_shared_draft_conflict" as const };
		if (row.account_status !== "connected" || row.provider !== "google") return { error: "mail_account_inactive" as const };
		const selected = (await tx.select().from(mailSharedDrafts).where(eq(mailSharedDrafts.id, row.id)).limit(1))[0];
		if (!selected) return { error: "mail_shared_draft_not_found" as const };
		const content = decryptDraft(selected);
		const now = new Date();
		const scheduledFor = new Date(now.getTime() + UNDO_WINDOW_MS);
		const envelope = encryptMailContent(
			{ accountId: row.account_id, provider: "google", providerMessageId: `outbound:${body.data.outboundId}` },
			content,
		);
		const requestHash = sha256(JSON.stringify({ action: "shared_draft_send", draftId: row.id, outboundId: body.data.outboundId, contentVersion: row.content_version }));
		await tx.insert(mailOutboundMessages).values({
			id: body.data.outboundId,
			workspaceId: row.account_workspace_id,
			accountId: row.account_id,
			ownerUserId: session.user.id,
			operationId: body.data.operationId,
			requestHash,
			status: "queued",
			scheduledFor,
			undoUntil: scheduledFor,
			...envelope,
		});
		const updated = (await tx.update(mailSharedDrafts).set({
			status: "queued",
			queuedAt: now,
			outboundId: body.data.outboundId,
			version: sql`${mailSharedDrafts.version} + 1`,
		}).where(and(eq(mailSharedDrafts.id, row.id), eq(mailSharedDrafts.version, row.version))).returning())[0];
		if (!updated) return { error: "mail_shared_draft_conflict" as const };
		await tx.insert(auditEvents).values({
			workspaceId: row.workspace_id, actorType: "user", actorUserId: session.user.id,
			entity: "mail_shared_draft", entityId: row.id, action: "approved_content_queued",
			diff: { contentVersion: row.content_version, outboundId: body.data.outboundId, undoSeconds: UNDO_WINDOW_MS / 1000 },
			requestId: c.get("requestId") ?? null,
		});
		return { row: updated, replayed: false };
	});
	if ("error" in result && result.error) return c.json({ error: result.error }, result.error.endsWith("not_found") ? 404 : 409);
	return c.json({ draft: await publicDraft(result.row, session.user.id), replayed: result.replayed }, result.replayed ? 200 : 201);
});
