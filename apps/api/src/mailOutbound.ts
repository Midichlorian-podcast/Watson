/** F5/M1 — skutečný osobní Gmail send, Undo Send a Send Later. */
import { createHash, randomUUID } from "node:crypto";
import {
	and,
	auditEvents,
	desc,
	eq,
	getDb,
	mailAccounts,
	mailCommandReceipts,
	mailOutboundMessages,
	mailSyncStates,
	sql,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";
import { decryptMailContent, encryptMailContent } from "./mailContentVault";
import { sendImapSmtpMessage } from "./mailImapSmtp";
import { authenticatedGoogleMailFetch, readMailProviderJson } from "./mailSync";
import type { MailVaultEnvelope } from "./mailVault";

export const mailOutboundRoutes = new Hono<{ Variables: { requestId: string } }>();

const UNDO_WINDOW_MS = 10_000;
const MAX_SCHEDULE_MS = 366 * 24 * 60 * 60_000;
const SEND_LEASE_MS = 2 * 60_000;
const RETRY_DELAY_MS = 60_000;
const MAX_ATTEMPTS = 5;

const email = z.string().trim().toLowerCase().email().max(320);
const recipients = z.array(email).max(50).default([]);
const enqueueSchema = z
	.object({
		id: z.string().uuid(),
		operationId: z.string().uuid(),
		to: z.array(email).min(1).max(50),
		cc: recipients.optional(),
		bcc: recipients.optional(),
		subject: z
			.string()
			.trim()
			.max(998)
			.refine((value) => !/[\r\n]/.test(value), "invalid_subject"),
		textBody: z.string().max(512 * 1024),
		sendAt: z.string().datetime({ offset: true }).nullable().optional(),
	})
	.strict()
	.refine((value) => value.subject.length > 0 || value.textBody.trim().length > 0, "empty_message")
	.refine(
		(value) => value.to.length + (value.cc?.length ?? 0) + (value.bcc?.length ?? 0) <= 100,
		"too_many_recipients",
	);
const cancelSchema = z
	.object({
		operationId: z.string().uuid(),
		expectedVersion: z.number().int().positive(),
	})
	.strict();
const providerAckSchema = z
	.object({
		id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
		threadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
	})
	.passthrough();
const outboundContentSchema = z.object({
	to: z.array(email).min(1).max(50),
	cc: z.array(email).max(50),
	bcc: z.array(email).max(50),
	subject: z.string().max(998),
	textBody: z.string().max(512 * 1024),
	inReplyTo: z.string().max(32_768).refine((value) => !/[\r\n]/.test(value)).nullable().optional(),
	references: z.array(z.string().max(32_768).refine((value) => !/[\r\n]/.test(value))).max(100).optional(),
});

type OutboundContent = z.infer<typeof outboundContentSchema>;
type OutboundStatus =
	| "queued"
	| "sending"
	| "retry"
	| "accepted"
	| "cancelled"
	| "uncertain"
	| "failed";

class MailOutboundError extends Error {
	constructor(
		readonly code: string,
		readonly status: 404 | 409 | 422 | 503,
	) {
		super(code);
	}
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function envelopeFrom(row: {
	algorithm: string;
	keyId: string;
	nonce: string;
	authTag: string;
	ciphertext: string;
}): MailVaultEnvelope {
	if (row.algorithm !== "aes-256-gcm-v1") throw new Error("mail_contract_rejected");
	return {
		algorithm: "aes-256-gcm-v1",
		keyId: row.keyId,
		nonce: row.nonce,
		authTag: row.authTag,
		ciphertext: row.ciphertext,
	};
}

function normalizeRecipients(input: z.infer<typeof enqueueSchema>): OutboundContent {
	const used = new Set<string>();
	const unique = (values: string[] | undefined) => {
		const result: string[] = [];
		for (const value of values ?? []) {
			const normalized = value.trim().toLowerCase();
			if (used.has(normalized)) continue;
			used.add(normalized);
			result.push(normalized);
		}
		return result;
	};
	return {
		to: unique(input.to),
		cc: unique(input.cc),
		bcc: unique(input.bcc),
		subject: input.subject,
		textBody: input.textBody.replace(/\r\n?/g, "\n"),
	};
}

function publicSummary(
	row: {
		id: string;
		accountId: string;
		status: string;
		scheduledFor: Date;
		undoUntil: Date;
		nextAttemptAt: Date | null;
		attempts: number;
		providerMessageId: string | null;
		providerThreadId: string | null;
		acceptedAt: Date | null;
		cancelledAt: Date | null;
		lastErrorCode: string | null;
		version: number;
		createdAt: Date;
	},
	content: OutboundContent | null,
) {
	const status = row.status as OutboundStatus;
	return {
		id: row.id,
		accountId: row.accountId,
		status,
		subject: content?.subject ?? null,
		recipientCount: content ? content.to.length + content.cc.length + content.bcc.length : null,
		contentUnavailable: content === null,
		scheduledFor: row.scheduledFor.toISOString(),
		undoUntil: row.undoUntil.toISOString(),
		nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
		attempts: row.attempts,
		providerMessageId: row.providerMessageId,
		providerThreadId: row.providerThreadId,
		acceptedAt: row.acceptedAt?.toISOString() ?? null,
		cancelledAt: row.cancelledAt?.toISOString() ?? null,
		lastErrorCode: row.lastErrorCode,
		version: row.version,
		createdAt: row.createdAt.toISOString(),
		canCancel: status === "queued" || status === "retry",
	};
}

type SupportedMailProvider = "google" | "imap_smtp";

function supportedProvider(value: string): SupportedMailProvider {
	if (value === "google" || value === "imap_smtp") return value;
	throw new Error("mail_provider_unsupported");
}

function decryptContent(row: typeof mailOutboundMessages.$inferSelect, provider: SupportedMailProvider): OutboundContent {
	return outboundContentSchema.parse(
		decryptMailContent(
			{ accountId: row.accountId, provider, providerMessageId: `outbound:${row.id}` },
			envelopeFrom(row),
		),
	);
}

async function ownerAccount(accountId: string, ownerUserId: string) {
	return (
		await getDb()
			.select({
				id: mailAccounts.id,
				workspaceId: mailAccounts.workspaceId,
				ownerUserId: mailAccounts.ownerUserId,
				provider: mailAccounts.provider,
				emailAddress: mailAccounts.emailAddress,
				status: mailAccounts.status,
			})
			.from(mailAccounts)
			.where(and(eq(mailAccounts.id, accountId), eq(mailAccounts.ownerUserId, ownerUserId)))
			.limit(1)
	)[0];
}

mailOutboundRoutes.get("/api/mail/accounts/:accountId/outbound", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const accountId = z.string().uuid().safeParse(c.req.param("accountId"));
	const limit = z.coerce.number().int().min(1).max(100).safeParse(c.req.query("limit") ?? "50");
	if (!accountId.success || !limit.success) return c.json({ error: "invalid_query" }, 422);
	const account = await ownerAccount(accountId.data, session.user.id);
	if (!account) return c.json({ error: "mail_account_not_found" }, 404);
	const rows = await getDb()
		.select()
		.from(mailOutboundMessages)
		.where(
			and(
				eq(mailOutboundMessages.accountId, account.id),
				eq(mailOutboundMessages.ownerUserId, session.user.id),
			),
		)
		.orderBy(desc(mailOutboundMessages.createdAt), desc(mailOutboundMessages.id))
		.limit(limit.data);
	const outbound = rows.map((row) => {
		try {
			return publicSummary(row, decryptContent(row, supportedProvider(account.provider)));
		} catch {
			return publicSummary(row, null);
		}
	});
	return c.json({ outbound });
});

mailOutboundRoutes.post("/api/mail/accounts/:accountId/outbound", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const accountId = z.string().uuid().safeParse(c.req.param("accountId"));
	const body = enqueueSchema.safeParse(await c.req.json().catch(() => null));
	if (!accountId.success || !body.success) return c.json({ error: "invalid_outbound_message" }, 422);
	const content = normalizeRecipients(body.data);
	if (content.to.length === 0) return c.json({ error: "invalid_outbound_message" }, 422);
	const requestedSendAt = body.data.sendAt ? new Date(body.data.sendAt) : null;
	const now = new Date();
	if (
		requestedSendAt &&
		(requestedSendAt.getTime() <= now.getTime() || requestedSendAt.getTime() > now.getTime() + MAX_SCHEDULE_MS)
	) return c.json({ error: "invalid_send_schedule" }, 422);
	const requestHash = sha256(
		JSON.stringify({
			action: "enqueue_outbound",
			accountId: accountId.data,
			id: body.data.id,
			content,
			sendAt: body.data.sendAt ?? null,
		}),
	);
	try {
		const result = await getDb().transaction(async (tx) => {
			const accountRows = (await tx.execute(sql`
				SELECT id, workspace_id, owner_user_id, provider, status
				FROM mail_accounts
				WHERE id = ${accountId.data} AND owner_user_id = ${session.user.id}
				FOR UPDATE
			`)) as unknown as Array<{
				id: string;
				workspace_id: string;
				owner_user_id: string;
				provider: string;
				status: string;
			}>;
			const account = accountRows[0];
			if (!account) throw new MailOutboundError("mail_account_not_found", 404);
			const replay = (
				await tx
					.select()
					.from(mailOutboundMessages)
					.where(
						and(
							eq(mailOutboundMessages.ownerUserId, session.user.id),
							eq(mailOutboundMessages.operationId, body.data.operationId),
						),
					)
					.limit(1)
			)[0];
			if (replay) {
				if (replay.requestHash !== requestHash) throw new MailOutboundError("operation_id_reused", 409);
				return { row: replay, replayed: true };
			}
			if (!(["google", "imap_smtp"] as string[]).includes(account.provider) || account.status !== "connected") {
				throw new MailOutboundError("mail_account_inactive", 409);
			}
			const provider = supportedProvider(account.provider);
			const undoUntil = new Date(now.getTime() + UNDO_WINDOW_MS);
			const scheduledFor = requestedSendAt && requestedSendAt > undoUntil ? requestedSendAt : undoUntil;
			const encrypted = encryptMailContent(
				{ accountId: account.id, provider, providerMessageId: `outbound:${body.data.id}` },
				content,
			);
			const inserted = await tx
				.insert(mailOutboundMessages)
				.values({
					id: body.data.id,
					workspaceId: account.workspace_id,
					accountId: account.id,
					ownerUserId: session.user.id,
					operationId: body.data.operationId,
					requestHash,
					status: "queued",
					scheduledFor,
					undoUntil,
					...encrypted,
				})
				.returning();
			const row = inserted[0];
			if (!row) throw new MailOutboundError("mail_outbound_conflict", 409);
			await tx.insert(auditEvents).values({
				workspaceId: account.workspace_id,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "mail_outbound",
				entityId: row.id,
				action: requestedSendAt ? "scheduled" : "queued_with_undo",
				diff: {
					provider,
					recipientCount: content.to.length + content.cc.length + content.bcc.length,
					hasSubject: content.subject.length > 0,
					bodyBytes: Buffer.byteLength(content.textBody, "utf8"),
				},
				requestId: c.get("requestId") ?? null,
			});
			return { row, replayed: false };
		});
		return c.json(
			{ outbound: publicSummary(result.row, content), replayed: result.replayed },
			result.replayed ? 200 : 201,
		);
	} catch (error) {
		if (error instanceof MailOutboundError) return c.json({ error: error.code }, error.status);
		const code = (error as { code?: string; cause?: { code?: string } })?.code ??
			(error as { cause?: { code?: string } })?.cause?.code;
		return c.json({ error: code === "23505" ? "mail_outbound_conflict" : "mail_outbound_unavailable" }, code === "23505" ? 409 : 503);
	}
});

mailOutboundRoutes.post("/api/mail/accounts/:accountId/outbound/:outboundId/cancel", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const ids = z
		.object({ accountId: z.string().uuid(), outboundId: z.string().uuid() })
		.safeParse(c.req.param());
	const body = cancelSchema.safeParse(await c.req.json().catch(() => null));
	if (!ids.success || !body.success) return c.json({ error: "invalid_cancel" }, 422);
	const requestHash = sha256(JSON.stringify({ action: "cancel_outbound", ...ids.data, ...body.data }));
	try {
		const result = await getDb().transaction(async (tx) => {
			const replay = (
				await tx
					.select()
					.from(mailCommandReceipts)
					.where(
						and(
							eq(mailCommandReceipts.actorUserId, session.user.id),
							eq(mailCommandReceipts.operationId, body.data.operationId),
						),
					)
					.limit(1)
			)[0];
			if (replay) {
				if (replay.requestHash !== requestHash || replay.action !== "cancel_outbound") {
					throw new MailOutboundError("operation_id_reused", 409);
				}
				return replay.response;
			}
			const rows = (await tx.execute(sql`
				SELECT outbound.*, account.workspace_id, account.provider
				FROM mail_outbound_messages outbound
				JOIN mail_accounts account ON account.id = outbound.account_id
				WHERE outbound.id = ${ids.data.outboundId}
				  AND outbound.account_id = ${ids.data.accountId}
				  AND outbound.owner_user_id = ${session.user.id}
				FOR UPDATE OF outbound
			`)) as unknown as Array<{ status: string; version: number; workspace_id: string; provider: string }>;
			const row = rows[0];
			if (!row) throw new MailOutboundError("mail_outbound_not_found", 404);
			if (row.version !== body.data.expectedVersion) throw new MailOutboundError("stale_version", 409);
			if (row.status !== "queued" && row.status !== "retry") {
				throw new MailOutboundError("mail_outbound_not_cancellable", 409);
			}
			const updated = await tx
				.update(mailOutboundMessages)
				.set({
					status: "cancelled",
					cancelledAt: new Date(),
					nextAttemptAt: null,
					lastErrorCode: null,
					version: sql`${mailOutboundMessages.version} + 1`,
				})
				.where(
					and(
						eq(mailOutboundMessages.id, ids.data.outboundId),
						eq(mailOutboundMessages.version, body.data.expectedVersion),
					),
				)
				.returning({ id: mailOutboundMessages.id, status: mailOutboundMessages.status, version: mailOutboundMessages.version });
			const publicResponse = updated[0];
			if (!publicResponse) throw new MailOutboundError("stale_version", 409);
			await tx.insert(mailCommandReceipts).values({
				accountId: ids.data.accountId,
				actorUserId: session.user.id,
				operationId: body.data.operationId,
				requestHash,
				action: "cancel_outbound",
				response: publicResponse,
			});
			await tx.insert(auditEvents).values({
				workspaceId: row.workspace_id,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "mail_outbound",
				entityId: ids.data.outboundId,
				action: "cancelled",
				diff: { provider: row.provider, previousStatus: row.status },
				requestId: c.get("requestId") ?? null,
			});
			return publicResponse;
		});
		return c.json({ outbound: result });
	} catch (error) {
		if (error instanceof MailOutboundError) return c.json({ error: error.code }, error.status);
		return c.json({ error: "mail_outbound_unavailable" }, 503);
	}
});

type ClaimedOutbound = {
	id: string;
	account_id: string;
	workspace_id: string;
	owner_user_id: string;
	lease_token: string;
	attempts: number;
	provider: SupportedMailProvider;
};

function headerValue(value: string): string {
	return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function wrapBase64(value: string): string {
	return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function buildRawMessage(id: string, from: string, content: OutboundContent): string {
	const headers = [
		`From: ${from}`,
		`To: ${content.to.join(", ")}`,
		content.cc.length ? `Cc: ${content.cc.join(", ")}` : null,
		content.bcc.length ? `Bcc: ${content.bcc.join(", ")}` : null,
		`Subject: ${headerValue(content.subject)}`,
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <watson-${id}@watson.invalid>`,
		content.inReplyTo ? `In-Reply-To: ${content.inReplyTo}` : null,
		content.references?.length ? `References: ${content.references.join(" ")}` : null,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: base64",
	].filter((value): value is string => value !== null);
	return [...headers, "", wrapBase64(Buffer.from(content.textBody, "utf8").toString("base64")), ""].join("\r\n");
}

async function claimOutbound(now: Date, limit = 10): Promise<ClaimedOutbound[]> {
	await getDb().execute(sql`
		UPDATE mail_outbound_messages
		SET status = 'uncertain', lease_token = NULL, lease_until = NULL,
		    last_error_code = 'mail_delivery_uncertain', version = version + 1, updated_at = now()
		WHERE status = 'sending' AND lease_until < ${now.toISOString()}::timestamptz
	`);
	const leaseToken = randomUUID();
	const rows = await getDb().transaction((tx) =>
		tx.execute(sql`
			WITH candidates AS (
				SELECT outbound.id
				FROM mail_outbound_messages outbound
				JOIN mail_accounts account ON account.id = outbound.account_id
				WHERE account.provider IN ('google', 'imap_smtp') AND account.status = 'connected'
				  AND outbound.scheduled_for <= ${now.toISOString()}::timestamptz
				  AND (
					outbound.status = 'queued'
					OR (outbound.status = 'retry' AND outbound.next_attempt_at <= ${now.toISOString()}::timestamptz)
				  )
				ORDER BY COALESCE(outbound.next_attempt_at, outbound.scheduled_for), outbound.id
				FOR UPDATE OF outbound SKIP LOCKED
				LIMIT ${limit}
			)
			UPDATE mail_outbound_messages outbound
			SET status = 'sending', lease_token = ${leaseToken}::uuid,
			    lease_until = ${new Date(now.getTime() + SEND_LEASE_MS).toISOString()}::timestamptz,
			    next_attempt_at = NULL, attempts = outbound.attempts + 1,
			    version = outbound.version + 1, updated_at = now()
			FROM candidates
			WHERE outbound.id = candidates.id
			RETURNING outbound.id, outbound.account_id, outbound.workspace_id,
			          outbound.owner_user_id, outbound.lease_token, outbound.attempts,
			          (SELECT provider FROM mail_accounts WHERE id = outbound.account_id) AS provider
		`),
	);
	return rows as unknown as ClaimedOutbound[];
}

async function finishOutbound(
	claim: ClaimedOutbound,
	result: {
		status: "accepted" | "retry" | "uncertain" | "failed";
		errorCode: string | null;
		providerMessageId?: string;
		providerThreadId?: string;
	},
) {
	const now = new Date();
	await getDb().transaction(async (tx) => {
		const updated = await tx
			.update(mailOutboundMessages)
			.set({
				status: result.status,
				leaseToken: null,
				leaseUntil: null,
				nextAttemptAt: result.status === "retry" ? new Date(now.getTime() + RETRY_DELAY_MS) : null,
				providerMessageId: result.providerMessageId ?? null,
				providerThreadId: result.providerThreadId ?? null,
				acceptedAt: result.status === "accepted" ? now : null,
				lastErrorCode: result.errorCode,
				version: sql`${mailOutboundMessages.version} + 1`,
			})
			.where(
				and(
					eq(mailOutboundMessages.id, claim.id),
					eq(mailOutboundMessages.leaseToken, claim.lease_token),
				),
			)
			.returning({ id: mailOutboundMessages.id });
		if (updated.length !== 1) return;
		await tx.insert(auditEvents).values({
			workspaceId: claim.workspace_id,
			actorType: "system",
			actorUserId: null,
			entity: "mail_outbound",
			entityId: claim.id,
			action:
				result.status === "accepted"
					? "provider_accepted"
					: result.status === "retry"
						? "provider_rate_limited"
						: result.status === "uncertain"
							? "delivery_uncertain"
							: "send_failed",
			diff: {
				provider: claim.provider,
				status: result.status,
				attempt: claim.attempts,
				errorCode: result.errorCode,
			},
		});
		if (result.status === "accepted") {
			await tx
				.insert(mailSyncStates)
				.values({ accountId: claim.account_id, status: "pending", syncMode: "full", requestedAt: now })
				.onConflictDoUpdate({
					target: mailSyncStates.accountId,
					set: {
						status: sql`CASE WHEN ${mailSyncStates.status} = 'running' THEN 'running' ELSE 'pending' END`,
						requestedAt: now,
						nextAttemptAt: null,
						lastErrorCode: null,
					},
				});
		}
	});
}

async function processOutbound(claim: ClaimedOutbound) {
	const row = (
		await getDb()
			.select({ outbound: mailOutboundMessages, account: mailAccounts })
			.from(mailOutboundMessages)
			.innerJoin(mailAccounts, eq(mailAccounts.id, mailOutboundMessages.accountId))
			.where(
				and(
					eq(mailOutboundMessages.id, claim.id),
					eq(mailOutboundMessages.leaseToken, claim.lease_token),
				),
			)
			.limit(1)
	)[0];
	if (!row) return;
	if (row.account.status !== "connected" || !(["google", "imap_smtp"] as string[]).includes(row.account.provider)) {
		return finishOutbound(claim, { status: "failed", errorCode: "mail_auth_rejected" });
	}
	const provider = supportedProvider(row.account.provider);
	let content: OutboundContent;
	try {
		content = decryptContent(row.outbound, provider);
	} catch {
		return finishOutbound(claim, { status: "failed", errorCode: "mail_contract_rejected" });
	}
	try {
		if (provider === "imap_smtp") {
			const ack = await sendImapSmtpMessage(row.account.id, row.outbound.id, content);
			return finishOutbound(claim, { status: "accepted", errorCode: null, providerMessageId: ack.id, providerThreadId: ack.threadId });
		}
		const raw = Buffer.from(buildRawMessage(row.outbound.id, row.account.emailAddress, content), "utf8").toString("base64url");
		const response = await authenticatedGoogleMailFetch(
			row.account.id,
			"/gmail/v1/users/me/messages/send",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ raw }),
			},
		);
		if (response.status === 429) {
			return finishOutbound(claim, {
				status: claim.attempts >= MAX_ATTEMPTS ? "failed" : "retry",
				errorCode: "mail_rate_limited",
			});
		}
		if (response.status === 401 || response.status === 403) {
			return finishOutbound(claim, { status: "failed", errorCode: "mail_auth_rejected" });
		}
		if (response.status >= 500) {
			return finishOutbound(claim, { status: "uncertain", errorCode: "mail_delivery_uncertain" });
		}
		if (!response.ok) {
			return finishOutbound(claim, { status: "failed", errorCode: "mail_contract_rejected" });
		}
		let providerPayload: unknown;
		try {
			providerPayload = await readMailProviderJson(response, 128 * 1024);
		} catch {
			return finishOutbound(claim, { status: "uncertain", errorCode: "mail_contract_rejected" });
		}
		const ack = providerAckSchema.safeParse(providerPayload);
		if (!ack.success) {
			return finishOutbound(claim, { status: "uncertain", errorCode: "mail_contract_rejected" });
		}
		return finishOutbound(claim, {
			status: "accepted",
			errorCode: null,
			providerMessageId: ack.data.id,
			providerThreadId: ack.data.threadId,
		});
	} catch (error) {
		const code = error instanceof Error ? error.message : "mail_provider_unavailable";
		const smtp = error as { responseCode?: number; code?: string };
		if (provider === "imap_smtp") {
			if (smtp.responseCode === 535 || /auth|credential|login/i.test(code)) return finishOutbound(claim, { status: "failed", errorCode: "mail_auth_rejected" });
			if (smtp.responseCode && smtp.responseCode >= 400 && smtp.responseCode < 500) return finishOutbound(claim, { status: claim.attempts >= MAX_ATTEMPTS ? "failed" : "retry", errorCode: "mail_rate_limited" });
			if (smtp.responseCode && smtp.responseCode >= 500) return finishOutbound(claim, { status: "failed", errorCode: "mail_contract_rejected" });
			return finishOutbound(claim, { status: "uncertain", errorCode: "mail_delivery_uncertain" });
		}
		if (code === "mail_auth_rejected" || code === "mail_account_inactive" || code === "mail_contract_rejected") {
			return finishOutbound(claim, {
				status: "failed",
				errorCode: code === "mail_account_inactive" ? "mail_auth_rejected" : code,
			});
		}
		return finishOutbound(claim, {
			status: "uncertain",
			errorCode: code === "mail_provider_timeout" ? "mail_provider_timeout" : "mail_delivery_uncertain",
		});
	}
}

export async function scanMailOutbound(now = new Date()): Promise<number> {
	const claims = await claimOutbound(now);
	await Promise.all(claims.map(processOutbound));
	return claims.length;
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startMailOutboundWorker(intervalMs = 1_000): void {
	if (timer) return;
	timer = setInterval(() => {
		scanMailOutbound().catch((error) =>
			console.error(
				JSON.stringify({
					level: "error",
					event: "mail_outbound_scan_failed",
					name: error instanceof Error ? error.name : "UnknownError",
				}),
			),
		);
	}, intervalMs);
	console.log(`[mail-outbound] worker běží (interval ${intervalMs / 1000}s)`);
}
