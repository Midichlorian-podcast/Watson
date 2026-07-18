/**
 * Advanced personal mail read model.
 *
 * Search deliberately decrypts only owner-scoped rows in process. Watson does
 * not create a plaintext full-text index of private mail merely for speed. The
 * API reports when the bounded synchronized corpus was truncated.
 */
import {
	and,
	auditEvents,
	contacts,
	desc,
	eq,
	getDb,
	inArray,
	mailAccounts,
	mailFollowups,
	mailMessages,
	mailOutboundMessages,
	mailProviderLabels,
	mailSavedViews,
	sql,
	workspaces,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";
import { decryptMailContent } from "./mailContentVault";
import type { MailVaultEnvelope } from "./mailVault";

export const mailAdvancedRoutes = new Hono<{ Variables: { requestId: string } }>();

const MAX_SEARCH_CORPUS = 5_000;
const attachmentSchema = z.object({
	filename: z.string().max(1024),
	mimeType: z.string().max(256),
	size: z.number().int().nonnegative(),
	attachmentId: z.string().max(1024).nullable(),
});
const storedContentSchema = z.object({
	subject: z.string().max(32_768),
	from: z.string().max(32_768),
	to: z.array(z.string().max(32_768)).max(200),
	cc: z.array(z.string().max(32_768)).max(200),
	replyTo: z.string().max(32_768),
	dateHeader: z.string().max(32_768),
	authenticationResults: z.string().max(32_768).default(""),
	returnPath: z.string().max(32_768).default(""),
	messageIdHeader: z.string().max(32_768).default(""),
	references: z.array(z.string().max(32_768)).max(100).default([]),
	snippet: z.string().max(32_768),
	textBody: z.string().max(256 * 1024),
	htmlBody: z.string().max(512 * 1024),
	attachments: z.array(attachmentSchema).max(256),
});
const outboundContentSchema = z.object({
	to: z.array(z.string().email().max(320)).max(50),
	cc: z.array(z.string().email().max(320)).max(50),
	bcc: z.array(z.string().email().max(320)).max(50),
	subject: z.string().max(998),
	textBody: z.string().max(512 * 1024),
});

function envelopeFrom(row: {
	algorithm: string;
	keyId: string;
	nonce: string;
	authTag: string;
	ciphertext: string;
}): MailVaultEnvelope {
	if (row.algorithm !== "aes-256-gcm-v1") throw new Error("mail_content_algorithm_unsupported");
	return {
		algorithm: "aes-256-gcm-v1",
		keyId: row.keyId,
		nonce: row.nonce,
		authTag: row.authTag,
		ciphertext: row.ciphertext,
	};
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

type SupportedMailProvider = "google" | "imap_smtp";

function supportedProvider(value: string): SupportedMailProvider {
	if (value === "google" || value === "imap_smtp") return value;
	throw new Error("mail_provider_unsupported");
}

function decryptMessage(row: typeof mailMessages.$inferSelect, provider: SupportedMailProvider) {
	return storedContentSchema.parse(decryptMailContent(
		{ accountId: row.accountId, provider, providerMessageId: row.providerMessageId },
		envelopeFrom(row),
	));
}

function decryptOutbound(row: typeof mailOutboundMessages.$inferSelect, provider: SupportedMailProvider) {
	return outboundContentSchema.parse(decryptMailContent(
		{ accountId: row.accountId, provider, providerMessageId: `outbound:${row.id}` },
		envelopeFrom(row),
	));
}

async function ownerAccounts(userId: string) {
	return getDb().select({
		id: mailAccounts.id,
		workspaceId: mailAccounts.workspaceId,
		provider: mailAccounts.provider,
		emailAddress: mailAccounts.emailAddress,
		displayName: mailAccounts.displayName,
		status: mailAccounts.status,
	}).from(mailAccounts).where(and(
		eq(mailAccounts.ownerUserId, userId),
		sql`${mailAccounts.status} <> 'revoked'`,
	));
}

async function personalWorkspaceId(userId: string) {
	return (await getDb().select({ id: workspaces.id }).from(workspaces).where(and(
		eq(workspaces.ownerId, userId),
		eq(workspaces.isPersonal, true),
	)).limit(1))[0]?.id ?? null;
}

type SearchQuery = {
	terms: string[];
	from: string | null;
	to: string | null;
	subject: string | null;
	account: string | null;
	label: string | null;
	hasAttachment: boolean;
	unread: boolean | null;
	after: number | null;
	before: number | null;
};

function parseDate(value: string, end = false): number | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const date = Date.parse(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
	return Number.isFinite(date) ? date : null;
}

export function parseMailSearch(value: string): SearchQuery {
	const tokens = value.trim().match(/[^\s:"]+:"[^"]*"|"[^"]*"|[^\s]+/g) ?? [];
	const query: SearchQuery = {
		terms: [], from: null, to: null, subject: null, account: null, label: null,
		hasAttachment: false, unread: null, after: null, before: null,
	};
	for (const raw of tokens) {
		const token = raw.replace(/^"|"$/g, "").trim();
		const separator = token.indexOf(":");
		const key = separator > 0 ? token.slice(0, separator).toLowerCase() : "";
		const operand = separator > 0 ? token.slice(separator + 1).replace(/^"|"$/g, "").toLowerCase() : "";
		if (key === "from" || key === "od") query.from = operand;
		else if (key === "to" || key === "komu") query.to = operand;
		else if (key === "subject" || key === "predmet") query.subject = operand;
		else if (key === "account" || key === "ucet" || key === "schranka") query.account = operand;
		else if (key === "label" || key === "stitek") query.label = operand;
		else if (key === "has" && ["attachment", "priloha"].includes(operand)) query.hasAttachment = true;
		else if (key === "is" && ["unread", "neprectene"].includes(operand)) query.unread = true;
		else if (key === "is" && ["read", "prectene"].includes(operand)) query.unread = false;
		else if (key === "after" || key === "po") query.after = parseDate(operand);
		else if (key === "before" || key === "pred") query.before = parseDate(operand, true);
		else query.terms.push(token.toLowerCase());
	}
	return query;
}

function includes(haystack: string | string[], needle: string | null) {
	return !needle || (Array.isArray(haystack) ? haystack.join(" ") : haystack).toLowerCase().includes(needle);
}

function matchesSearch(
	row: typeof mailMessages.$inferSelect,
	content: z.infer<typeof storedContentSchema>,
	query: SearchQuery,
	accountLabel: string,
	labelNames: string[],
) {
	const time = row.internalDate.getTime();
	if (!includes(content.from, query.from)) return false;
	if (!includes([...content.to, ...content.cc], query.to)) return false;
	if (!includes(content.subject, query.subject)) return false;
	if (!includes(accountLabel, query.account)) return false;
	if (query.label && !includes([...row.labelIds, ...labelNames], query.label)) return false;
	if (query.hasAttachment && content.attachments.length === 0) return false;
	if (query.unread !== null && row.labelIds.includes("UNREAD") !== query.unread) return false;
	if (query.after !== null && time < query.after) return false;
	if (query.before !== null && time > query.before) return false;
	const haystack = [
		content.subject, content.from, ...content.to, ...content.cc, content.snippet, content.textBody,
	].join(" ").toLowerCase();
	return query.terms.every((term) => haystack.includes(term));
}

mailAdvancedRoutes.get("/api/mail/search", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const parsed = z.object({
		q: z.string().trim().min(1).max(1000),
		limit: z.coerce.number().int().min(1).max(50).default(25),
	}).safeParse({ q: c.req.query("q"), limit: c.req.query("limit") ?? 25 });
	if (!parsed.success) return c.json({ error: "invalid_mail_search" }, 422);
	const accounts = await ownerAccounts(session.user.id);
	const supportedAccounts = accounts.filter((account) => account.provider === "google" || account.provider === "imap_smtp");
	if (supportedAccounts.length === 0) return c.json({ messages: [], searchedCount: 0, truncated: false });
	const accountIds = supportedAccounts.map((account) => account.id);
	const [rows, labelRows] = await Promise.all([
		getDb().select().from(mailMessages).where(inArray(mailMessages.accountId, accountIds))
			.orderBy(desc(mailMessages.internalDate), desc(mailMessages.id)).limit(MAX_SEARCH_CORPUS + 1),
		getDb().select().from(mailProviderLabels).where(inArray(mailProviderLabels.accountId, accountIds)),
	]);
	const accountById = new Map(supportedAccounts.map((account) => [account.id, account]));
	const labelByAccount = new Map<string, Map<string, string>>();
	for (const label of labelRows) {
		const map = labelByAccount.get(label.accountId) ?? new Map<string, string>();
		map.set(label.providerLabelId, label.name);
		labelByAccount.set(label.accountId, map);
	}
	const query = parseMailSearch(parsed.data.q);
	const messages = [] as Array<Record<string, unknown>>;
	let skippedCorrupt = 0;
	for (const row of rows.slice(0, MAX_SEARCH_CORPUS)) {
		const account = accountById.get(row.accountId);
		if (!account) continue;
		try {
			const content = decryptMessage(row, supportedProvider(account.provider));
			const labelNames = row.labelIds.map((id) => labelByAccount.get(row.accountId)?.get(id) ?? id);
			const accountLabel = `${account.displayName ?? ""} ${account.emailAddress}`.trim();
			if (!matchesSearch(row, content, query, accountLabel, labelNames)) continue;
			messages.push({
				accountId: row.accountId,
				accountLabel,
				id: row.id,
				providerMessageId: row.providerMessageId,
				threadId: row.providerThreadId,
				internalDate: row.internalDate.toISOString(),
				labelIds: row.labelIds,
				labelNames,
				subject: content.subject,
				from: content.from,
				to: content.to,
				snippet: content.snippet,
				attachmentCount: content.attachments.length,
			});
			if (messages.length >= parsed.data.limit) break;
		} catch {
			skippedCorrupt += 1;
		}
	}
	return c.json({
		messages,
		searchedCount: Math.min(rows.length, MAX_SEARCH_CORPUS),
		truncated: rows.length > MAX_SEARCH_CORPUS,
		skippedCorrupt,
	});
});

const viewBodySchema = z.object({
	id: z.string().uuid().optional(),
	name: z.string().trim().min(1).max(120),
	query: z.string().trim().min(1).max(1000),
	sort: z.enum(["newest", "oldest", "sender", "subject"]).default("newest"),
}).strict();

function publicView(row: typeof mailSavedViews.$inferSelect) {
	return { id: row.id, name: row.name, query: row.query, sort: row.sort, version: row.version };
}

mailAdvancedRoutes.get("/api/mail/views", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const rows = await getDb().select().from(mailSavedViews)
		.where(eq(mailSavedViews.ownerUserId, session.user.id))
		.orderBy(desc(mailSavedViews.updatedAt), desc(mailSavedViews.id));
	return c.json({ views: rows.map(publicView) });
});

mailAdvancedRoutes.post("/api/mail/views", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const body = viewBodySchema.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: "invalid_mail_view" }, 422);
	const workspaceId = await personalWorkspaceId(session.user.id);
	if (!workspaceId) return c.json({ error: "personal_workspace_missing" }, 409);
	try {
		const row = (await getDb().insert(mailSavedViews).values({
			id: body.data.id,
			workspaceId,
			ownerUserId: session.user.id,
			name: body.data.name,
			query: body.data.query,
			sort: body.data.sort,
		}).returning())[0];
		if (!row) throw new Error("mail_view_create_failed");
		return c.json({ view: publicView(row) }, 201);
	} catch (error) {
		if (sqlState(error) === "23505") return c.json({ error: "mail_view_name_exists" }, 409);
		throw error;
	}
});

const updateViewSchema = z.object({
	name: z.string().trim().min(1).max(120),
	query: z.string().trim().min(1).max(1000),
	sort: z.enum(["newest", "oldest", "sender", "subject"]),
	expectedVersion: z.number().int().positive(),
}).strict();

mailAdvancedRoutes.put("/api/mail/views/:viewId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const viewId = z.string().uuid().safeParse(c.req.param("viewId"));
	const body = updateViewSchema.safeParse(await c.req.json().catch(() => null));
	if (!viewId.success || !body.success) return c.json({ error: "invalid_mail_view" }, 422);
	try {
		const row = (await getDb().update(mailSavedViews).set({
			name: body.data.name,
			query: body.data.query,
			sort: body.data.sort,
			version: sql`${mailSavedViews.version} + 1`,
		}).where(and(
			eq(mailSavedViews.id, viewId.data),
			eq(mailSavedViews.ownerUserId, session.user.id),
			eq(mailSavedViews.version, body.data.expectedVersion),
		)).returning())[0];
		if (!row) return c.json({ error: "mail_view_conflict" }, 409);
		return c.json({ view: publicView(row) });
	} catch (error) {
		if (sqlState(error) === "23505") return c.json({ error: "mail_view_name_exists" }, 409);
		throw error;
	}
});

mailAdvancedRoutes.delete("/api/mail/views/:viewId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const viewId = z.string().uuid().safeParse(c.req.param("viewId"));
	const expectedVersion = z.coerce.number().int().positive().safeParse(c.req.query("expectedVersion"));
	if (!viewId.success || !expectedVersion.success) return c.json({ error: "invalid_mail_view" }, 422);
	const deleted = await getDb().delete(mailSavedViews).where(and(
		eq(mailSavedViews.id, viewId.data),
		eq(mailSavedViews.ownerUserId, session.user.id),
		eq(mailSavedViews.version, expectedVersion.data),
	)).returning({ id: mailSavedViews.id });
	if (deleted.length === 0) return c.json({ error: "mail_view_conflict" }, 409);
	return c.json({ deleted: true });
});

mailAdvancedRoutes.get("/api/mail/labels", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const accounts = await ownerAccounts(session.user.id);
	const accountIds = accounts.map((account) => account.id);
	if (accountIds.length === 0) return c.json({ labels: [] });
	const rows = await getDb().select().from(mailProviderLabels)
		.where(inArray(mailProviderLabels.accountId, accountIds))
		.orderBy(mailProviderLabels.kind, mailProviderLabels.name);
	return c.json({ labels: rows.map((row) => ({
		accountId: row.accountId,
		providerLabelId: row.providerLabelId,
		name: row.name,
		kind: row.kind,
		color: row.color,
	})) });
});

async function reconcileFollowups(userId: string) {
	const waiting = await getDb().select({
		followup: mailFollowups,
		outbound: mailOutboundMessages,
	}).from(mailFollowups).innerJoin(
		mailOutboundMessages,
		eq(mailOutboundMessages.id, mailFollowups.outboundId),
	).where(and(
		eq(mailFollowups.ownerUserId, userId),
		eq(mailFollowups.status, "waiting"),
	));
	for (const item of waiting) {
		if (!item.outbound.providerThreadId || !item.outbound.acceptedAt) continue;
		const reply = (await getDb().select({ id: mailMessages.id }).from(mailMessages).where(and(
			eq(mailMessages.accountId, item.outbound.accountId),
			eq(mailMessages.providerThreadId, item.outbound.providerThreadId),
			sql`${mailMessages.internalDate} > ${item.outbound.acceptedAt.toISOString()}::timestamptz`,
			sql`NOT (${mailMessages.labelIds} ? 'SENT')`,
		)).limit(1))[0];
		if (reply) await getDb().update(mailFollowups).set({
			status: "replied",
			completedAt: new Date(),
			version: sql`${mailFollowups.version} + 1`,
		}).where(and(eq(mailFollowups.id, item.followup.id), eq(mailFollowups.status, "waiting")));
	}
}

function publicFollowup(row: typeof mailFollowups.$inferSelect, subject: string | null) {
	return {
		id: row.id,
		accountId: row.accountId,
		outboundId: row.outboundId,
		subject,
		dueAt: row.dueAt.toISOString(),
		status: row.status,
		completedAt: row.completedAt?.toISOString() ?? null,
		version: row.version,
	};
}

mailAdvancedRoutes.get("/api/mail/followups", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	await reconcileFollowups(session.user.id);
	const rows = await getDb()
		.select({ followup: mailFollowups, outbound: mailOutboundMessages, provider: mailAccounts.provider })
		.from(mailFollowups)
		.innerJoin(mailOutboundMessages, eq(mailOutboundMessages.id, mailFollowups.outboundId))
		.innerJoin(mailAccounts, eq(mailAccounts.id, mailOutboundMessages.accountId))
		.where(eq(mailFollowups.ownerUserId, session.user.id))
		.orderBy(mailFollowups.dueAt, mailFollowups.id)
		.limit(200);
	return c.json({ followups: rows.map((item) => {
		let subject: string | null = null;
		try { subject = decryptOutbound(item.outbound, supportedProvider(item.provider)).subject; } catch { /* unavailable key remains fail-closed */ }
		return publicFollowup(item.followup, subject);
	}) });
});

const followupBodySchema = z.object({ dueAt: z.string().datetime({ offset: true }) }).strict();

mailAdvancedRoutes.post("/api/mail/accounts/:accountId/outbound/:outboundId/followup", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const ids = z.object({ accountId: z.string().uuid(), outboundId: z.string().uuid() }).safeParse(c.req.param());
	const body = followupBodySchema.safeParse(await c.req.json().catch(() => null));
	if (!ids.success || !body.success) return c.json({ error: "invalid_mail_followup" }, 422);
	const dueAt = new Date(body.data.dueAt);
	if (dueAt.getTime() <= Date.now() || dueAt.getTime() > Date.now() + 366 * 24 * 60 * 60_000) {
		return c.json({ error: "invalid_mail_followup_due" }, 422);
	}
	const outbound = (await getDb().select().from(mailOutboundMessages).where(and(
		eq(mailOutboundMessages.id, ids.data.outboundId),
		eq(mailOutboundMessages.accountId, ids.data.accountId),
		eq(mailOutboundMessages.ownerUserId, session.user.id),
		eq(mailOutboundMessages.status, "accepted"),
	)).limit(1))[0];
	if (!outbound) return c.json({ error: "mail_outbound_not_followable" }, 409);
	const account = (await getDb().select({ provider: mailAccounts.provider }).from(mailAccounts).where(and(
		eq(mailAccounts.id, outbound.accountId), eq(mailAccounts.ownerUserId, session.user.id),
	)).limit(1))[0];
	if (!account) return c.json({ error: "mail_account_not_found" }, 404);
	const row = (await getDb().insert(mailFollowups).values({
		workspaceId: outbound.workspaceId,
		accountId: outbound.accountId,
		ownerUserId: session.user.id,
		outboundId: outbound.id,
		dueAt,
	}).onConflictDoUpdate({
		target: mailFollowups.outboundId,
		set: { dueAt, status: "waiting", completedAt: null, version: sql`${mailFollowups.version} + 1` },
	}).returning())[0];
	if (!row) throw new Error("mail_followup_create_failed");
	await getDb().insert(auditEvents).values({
		workspaceId: outbound.workspaceId,
		actorType: "user",
		actorUserId: session.user.id,
		entity: "mail_followup",
		entityId: row.id,
		action: "scheduled",
		diff: { accountId: outbound.accountId, outboundId: outbound.id, dueAt: dueAt.toISOString() },
		requestId: c.get("requestId") ?? null,
	});
	let subject: string | null = null;
	try { subject = decryptOutbound(outbound, supportedProvider(account.provider)).subject; } catch { /* fail-closed content */ }
	return c.json({ followup: publicFollowup(row, subject) }, 201);
});

const followupUpdateSchema = z.object({
	status: z.enum(["done", "cancelled"]),
	expectedVersion: z.number().int().positive(),
}).strict();

mailAdvancedRoutes.patch("/api/mail/followups/:followupId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const id = z.string().uuid().safeParse(c.req.param("followupId"));
	const body = followupUpdateSchema.safeParse(await c.req.json().catch(() => null));
	if (!id.success || !body.success) return c.json({ error: "invalid_mail_followup" }, 422);
	const row = (await getDb().update(mailFollowups).set({
		status: body.data.status,
		completedAt: new Date(),
		version: sql`${mailFollowups.version} + 1`,
	}).where(and(
		eq(mailFollowups.id, id.data),
		eq(mailFollowups.ownerUserId, session.user.id),
		eq(mailFollowups.version, body.data.expectedVersion),
		eq(mailFollowups.status, "waiting"),
	)).returning())[0];
	if (!row) return c.json({ error: "mail_followup_conflict" }, 409);
	return c.json({ followup: publicFollowup(row, null) });
});

mailAdvancedRoutes.get("/api/mail/analytics", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const days = z.coerce.number().int().min(1).max(365).safeParse(c.req.query("days") ?? "30");
	if (!days.success) return c.json({ error: "invalid_mail_analytics_range" }, 422);
	await reconcileFollowups(session.user.id);
	const accounts = await ownerAccounts(session.user.id);
	const accountIds = accounts.map((account) => account.id);
	if (accountIds.length === 0) return c.json({
		rangeDays: days.data, total: 0, unread: 0, inbox: 0, waitingOver24h: 0,
		overdueFollowups: 0, outboundAccepted: 0, byAccount: [],
	});
	const since = new Date(Date.now() - days.data * 24 * 60 * 60_000);
	const [counts, outbound, followups] = await Promise.all([
		getDb().select({
			accountId: mailMessages.accountId,
			total: sql<number>`count(*)::int`,
			unread: sql<number>`count(*) filter (where ${mailMessages.labelIds} ? 'UNREAD')::int`,
			inbox: sql<number>`count(*) filter (where ${mailMessages.labelIds} ? 'INBOX')::int`,
			waitingOver24h: sql<number>`count(*) filter (where ${mailMessages.labelIds} ? 'INBOX' and ${mailMessages.labelIds} ? 'UNREAD' and ${mailMessages.internalDate} < now() - interval '24 hours')::int`,
		}).from(mailMessages).where(and(
			inArray(mailMessages.accountId, accountIds),
			sql`${mailMessages.internalDate} >= ${since.toISOString()}::timestamptz`,
		)).groupBy(mailMessages.accountId),
		getDb().select({ count: sql<number>`count(*)::int` }).from(mailOutboundMessages).where(and(
			eq(mailOutboundMessages.ownerUserId, session.user.id),
			eq(mailOutboundMessages.status, "accepted"),
			sql`${mailOutboundMessages.acceptedAt} >= ${since.toISOString()}::timestamptz`,
		)),
		getDb().select({ count: sql<number>`count(*)::int` }).from(mailFollowups).where(and(
			eq(mailFollowups.ownerUserId, session.user.id),
			eq(mailFollowups.status, "waiting"),
			sql`${mailFollowups.dueAt} < now()`,
		)),
	]);
	const countByAccount = new Map(counts.map((row) => [row.accountId, row]));
	const byAccount = accounts.map((account) => ({
		accountId: account.id,
		accountLabel: account.displayName ?? account.emailAddress,
		emailAddress: account.emailAddress,
		total: countByAccount.get(account.id)?.total ?? 0,
		unread: countByAccount.get(account.id)?.unread ?? 0,
		inbox: countByAccount.get(account.id)?.inbox ?? 0,
		waitingOver24h: countByAccount.get(account.id)?.waitingOver24h ?? 0,
	}));
	return c.json({
		rangeDays: days.data,
		total: byAccount.reduce((sum, row) => sum + row.total, 0),
		unread: byAccount.reduce((sum, row) => sum + row.unread, 0),
		inbox: byAccount.reduce((sum, row) => sum + row.inbox, 0),
		waitingOver24h: byAccount.reduce((sum, row) => sum + row.waitingOver24h, 0),
		overdueFollowups: followups[0]?.count ?? 0,
		outboundAccepted: outbound[0]?.count ?? 0,
		byAccount,
		note: "Agregace schránky, nikoli skóre produktivity zaměstnance.",
	});
});

function normalizedAddress(value: string) {
	const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(value)?.[1];
	const plain = /(?:^|\s)([^<>\s]+@[^<>\s]+)(?:$|\s)/.exec(value)?.[1];
	return (angle ?? plain ?? value).trim().replace(/^mailto:/i, "").toLowerCase();
}

mailAdvancedRoutes.get("/api/mail/people/lookup", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const address = z.string().trim().toLowerCase().email().max(320).safeParse(c.req.query("address"));
	if (!address.success) return c.json({ error: "invalid_mail_address" }, 422);
	const workspaceId = await personalWorkspaceId(session.user.id);
	const accounts = await ownerAccounts(session.user.id);
	const supportedAccounts = accounts.filter((a) => a.provider === "google" || a.provider === "imap_smtp");
	const accountIds = supportedAccounts.map((a) => a.id);
	const providerByAccount = new Map(supportedAccounts.map((account) => [account.id, supportedProvider(account.provider)]));
	const contact = workspaceId ? (await getDb().select().from(contacts).where(and(
		eq(contacts.workspaceId, workspaceId),
		sql`lower(${contacts.email}) = ${address.data}`,
	)).limit(1))[0] : null;
	let messages = 0;
	let lastContactAt: string | null = null;
	if (accountIds.length > 0) {
		const rows = await getDb().select().from(mailMessages)
			.where(inArray(mailMessages.accountId, accountIds))
			.orderBy(desc(mailMessages.internalDate)).limit(2_000);
		for (const row of rows) {
			try {
				const provider = providerByAccount.get(row.accountId);
				if (!provider) continue;
				const content = decryptMessage(row, provider);
				const participants = [content.from, ...content.to, ...content.cc].map(normalizedAddress);
				if (!participants.includes(address.data)) continue;
				messages += 1;
				lastContactAt ??= row.internalDate.toISOString();
			} catch { /* corrupted envelope never broadens visibility */ }
		}
	}
	const domain = address.data.split("@")[1] ?? "";
	return c.json({
		person: {
			address: address.data,
			name: contact?.name ?? address.data.split("@")[0],
			organization: contact?.org ?? null,
			role: contact?.role ?? null,
			areas: contact?.areas ?? null,
			note: contact?.note ?? null,
			domain,
			messages,
			lastContactAt,
			contactId: contact?.id ?? null,
		},
	});
});
