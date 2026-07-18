/** Generic owner-only IMAP/SMTP adapter with encrypted credentials and bounded sync. */
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
	and,
	auditEvents,
	eq,
	getDb,
	mailAccountCredentials,
	mailAccounts,
	mailMessages,
	mailProviderLabels,
	mailSyncStates,
	sql,
	workspaces,
} from "@watson/db";
import { Hono } from "hono";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { z } from "zod";
import { auth } from "./auth";
import { encryptMailContent } from "./mailContentVault";
import { decryptMailSecret, encryptMailSecret, type MailVaultEnvelope } from "./mailVault";

export const mailImapSmtpRoutes = new Hono<{ Variables: { requestId: string } }>();
const CONNECT_TIMEOUT_MS = 12_000;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_HTML_BYTES = 512 * 1024;
const PAGE_SIZE = 50;
const MAX_UIDS_PER_MAILBOX = 200_000;
const IDLE_POLL_MS = 60_000;
const endpointSchema = z.object({
	host: z.string().trim().toLowerCase().min(1).max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
	port: z.number().int().min(1).max(65_535),
	security: z.enum(["tls", "starttls"]),
}).strict();
export const imapSmtpCredentialSchema = z.object({
	purpose: z.literal("imap_smtp_mailbox"),
	emailAddress: z.string().trim().toLowerCase().email().max(320),
	username: z.string().min(1).max(1024),
	password: z.string().min(1).max(8192),
	imap: endpointSchema,
	smtp: endpointSchema,
}).strict();
const connectSchema = imapSmtpCredentialSchema.omit({ purpose: true }).extend({
	id: z.string().uuid().optional(),
	displayName: z.string().trim().min(1).max(160).nullable().optional(),
}).strict();
type Credential = z.infer<typeof imapSmtpCredentialSchema>;
type OutboundContent = { to: string[]; cc: string[]; bcc: string[]; subject: string; textBody: string; inReplyTo?: string | null; references?: string[] };

function sha256(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

function opaqueId(value: string) {
	return createHash("sha256").update(value).digest("base64url").slice(0, 43);
}

function authenticationFailure(error: unknown) {
	const candidate = error as { authenticationFailed?: boolean; responseCode?: number; code?: string; message?: string };
	return candidate?.authenticationFailed === true || candidate?.responseCode === 535 ||
		candidate?.code === "EAUTH" || /auth|credential|login/i.test(candidate?.message ?? "");
}

function privateIpv4(address: string) {
	const parts = address.split(".").map(Number);
	const [a = -1, b = -1, c = -1] = parts;
	return a === 0 || a === 10 || a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168 || (b === 88 && c === 99))) ||
		(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
		(a === 203 && b === 0 && c === 113) || a >= 224;
}

export function privateMailAddress(address: string) {
	if (isIP(address) === 4) return privateIpv4(address);
	const normalized = address.toLowerCase().split("%")[0] ?? "";
	if (normalized.startsWith("::ffff:") || normalized.startsWith("0:0:0:0:0:ffff:")) return true;
	return normalized === "::" || normalized === "::1" ||
		/^fe[89ab]/.test(normalized) || /^(?:fc|fd|ff)/.test(normalized) ||
		normalized.startsWith("100:") || normalized.startsWith("2001:db8:") ||
		normalized.startsWith("2001:10:") || normalized.startsWith("2001:0000:") ||
		normalized.startsWith("2002:") || normalized.startsWith("64:ff9b:");
}

export async function resolvePublicEndpoint(host: string) {
	if (isIP(host) && privateMailAddress(host)) throw new Error("mail_endpoint_private");
	const addresses = await lookup(host, { all: true, verbatim: true });
	if (addresses.length === 0) throw new Error("mail_endpoint_unresolved");
	const publicAddresses = addresses.filter((entry) => !privateMailAddress(entry.address));
	if (publicAddresses.length !== addresses.length) throw new Error("mail_endpoint_private");
	return publicAddresses[0]?.address ?? (() => { throw new Error("mail_endpoint_unresolved"); })();
}

function imapClient(credential: Credential, host: string) {
	return new ImapFlow({
		host, port: credential.imap.port, secure: credential.imap.security === "tls",
		doSTARTTLS: credential.imap.security === "starttls", auth: { user: credential.username, pass: credential.password },
		logger: false, disableAutoIdle: true, connectionTimeout: CONNECT_TIMEOUT_MS,
		greetingTimeout: CONNECT_TIMEOUT_MS, socketTimeout: 30_000,
		tls: { servername: credential.imap.host, rejectUnauthorized: true },
	});
}

function smtpTransport(credential: Credential, host: string) {
	return nodemailer.createTransport({
		host, port: credential.smtp.port, secure: credential.smtp.security === "tls",
		requireTLS: credential.smtp.security === "starttls", auth: { user: credential.username, pass: credential.password },
		connectionTimeout: CONNECT_TIMEOUT_MS, greetingTimeout: CONNECT_TIMEOUT_MS, socketTimeout: 30_000,
		tls: { servername: credential.smtp.host, rejectUnauthorized: true },
	});
}

type ImapVerifier = Pick<ImapFlow, "connect" | "getMailboxLock" | "logout" | "close">;
type SmtpVerifier = { verify: () => Promise<unknown>; close: () => void };
export type VerifyImapSmtpDependencies = {
	resolveEndpoint: (host: string) => Promise<string>;
	createImap: (credential: Credential, host: string) => ImapVerifier;
	createSmtp: (credential: Credential, host: string) => SmtpVerifier;
};

export async function verifyImapSmtpCredential(
	credential: Credential,
	dependencies: VerifyImapSmtpDependencies = {
		resolveEndpoint: resolvePublicEndpoint,
		createImap: imapClient,
		createSmtp: smtpTransport,
	},
) {
	const [imapHost, smtpHost] = await Promise.all([
		dependencies.resolveEndpoint(credential.imap.host), dependencies.resolveEndpoint(credential.smtp.host),
	]);
	const client = dependencies.createImap(credential, imapHost);
	try {
		await client.connect();
		const lock = await client.getMailboxLock("INBOX");
		lock.release();
	} finally {
		await client.logout().catch(() => client.close());
	}
	const transporter = dependencies.createSmtp(credential, smtpHost);
	try { await transporter.verify(); } finally { transporter.close(); }
}

function envelopeFrom(row: { algorithm: string; keyId: string; nonce: string; authTag: string; ciphertext: string }): MailVaultEnvelope {
	if (row.algorithm !== "aes-256-gcm-v1") throw new Error("mail_vault_algorithm_unsupported");
	return { algorithm: "aes-256-gcm-v1", keyId: row.keyId, nonce: row.nonce, authTag: row.authTag, ciphertext: row.ciphertext };
}

async function credentialFor(accountId: string): Promise<{ account: typeof mailAccounts.$inferSelect; credential: Credential }> {
	const row = (await getDb().select({ account: mailAccounts, secret: mailAccountCredentials })
		.from(mailAccounts).innerJoin(mailAccountCredentials, eq(mailAccountCredentials.accountId, mailAccounts.id))
		.where(and(eq(mailAccounts.id, accountId), eq(mailAccounts.provider, "imap_smtp"))).limit(1))[0];
	if (row?.account.status !== "connected") throw new Error("mail_account_inactive");
	const credential = imapSmtpCredentialSchema.parse(decryptMailSecret({
		accountId, ownerUserId: row.account.ownerUserId, provider: "imap_smtp", secretKind: "imap_smtp",
	}, envelopeFrom(row.secret)));
	return { account: row.account, credential };
}

mailImapSmtpRoutes.post("/api/mail/accounts/imap-smtp", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const body = connectSchema.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: "invalid_imap_smtp_account" }, 422);
	const { id: requestedId, displayName, ...credentialInput } = body.data;
	const credential: Credential = { purpose: "imap_smtp_mailbox", ...credentialInput };
	try { await verifyImapSmtpCredential(credential); } catch (error) {
		const message = error instanceof Error ? error.message : "";
		const code = ["mail_endpoint_private", "mail_endpoint_unresolved"].includes(message)
			? message
			: authenticationFailure(error) ? "mail_credentials_invalid" : "mail_connection_verification_failed";
		return c.json({ error: code }, code === "mail_endpoint_private" ? 403 : 422);
	}
	const workspace = (await getDb().select({ id: workspaces.id }).from(workspaces).where(and(
		eq(workspaces.ownerId, session.user.id), eq(workspaces.isPersonal, true),
	)).limit(1))[0];
	if (!workspace) return c.json({ error: "personal_workspace_missing" }, 409);
	const providerAccountHash = sha256(`${credential.emailAddress}\0${credential.username}\0${credential.imap.host}`);
	try {
		const stored = await getDb().transaction(async (tx) => {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mail:imap:${session.user.id}:${providerAccountHash}`}, 0))`);
			const existing = (await tx.select().from(mailAccounts).where(and(
				eq(mailAccounts.ownerUserId, session.user.id), eq(mailAccounts.provider, "imap_smtp"),
				eq(mailAccounts.providerAccountHash, providerAccountHash),
			)).limit(1))[0];
			const id = existing?.id ?? requestedId ?? randomUUID();
			const encrypted = encryptMailSecret({ accountId: id, ownerUserId: session.user.id, provider: "imap_smtp", secretKind: "imap_smtp" }, credential);
			const row = existing
				? (await tx.update(mailAccounts).set({ emailAddress: credential.emailAddress, displayName: displayName ?? null, status: "connected", revokedAt: null, lastErrorCode: null, grantedScopes: ["imap", "smtp"], capabilities: ["imap_sync", "smtp_send", "unified_inbox"], version: sql`${mailAccounts.version} + 1` }).where(eq(mailAccounts.id, id)).returning())[0]
				: (await tx.insert(mailAccounts).values({ id, workspaceId: workspace.id, ownerUserId: session.user.id, provider: "imap_smtp", emailAddress: credential.emailAddress, displayName: displayName ?? null, providerAccountHash, grantedScopes: ["imap", "smtp"], capabilities: ["imap_sync", "smtp_send", "unified_inbox"], lastSuccessAt: new Date() }).returning())[0];
			if (!row) throw new Error("mail_account_write_failed");
			await tx.insert(mailAccountCredentials).values({ accountId: id, secretKind: "imap_smtp", ...encrypted }).onConflictDoUpdate({ target: mailAccountCredentials.accountId, set: { secretKind: "imap_smtp", ...encrypted, credentialVersion: sql`${mailAccountCredentials.credentialVersion} + 1` } });
			await tx.insert(mailSyncStates).values({ accountId: id, status: "pending", syncMode: "full", requestedAt: new Date() }).onConflictDoUpdate({ target: mailSyncStates.accountId, set: { status: "pending", syncMode: "full", historyId: null, baselineHistoryId: null, pageToken: null, requestedAt: new Date(), nextAttemptAt: null, leaseToken: null, leaseUntil: null, attempts: 0, lastErrorCode: null, fullSyncGeneration: randomUUID(), version: sql`${mailSyncStates.version} + 1` } });
			await tx.insert(auditEvents).values({ workspaceId: workspace.id, actorType: "user", actorUserId: session.user.id, entity: "mail_account", entityId: id, action: existing ? "reconnected" : "connected", diff: { provider: "imap_smtp", verified: ["imap", "smtp"] }, requestId: c.get("requestId") ?? null });
			return { row, existed: Boolean(existing) };
		});
		const account = stored.row;
		const response = { account: { id: account.id, provider: account.provider, emailAddress: account.emailAddress, displayName: account.displayName, status: account.status, grantedScopes: account.grantedScopes, capabilities: account.capabilities, lastSuccessAt: account.lastSuccessAt?.toISOString() ?? null, lastErrorCode: account.lastErrorCode, revokedAt: account.revokedAt?.toISOString() ?? null, version: account.version } };
		return stored.existed ? c.json(response) : c.json(response, 201);
	} catch (error) {
		const state = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
		if (state === "23505") return c.json({ error: "mail_account_exists" }, 409);
		throw error;
	}
});

type ClaimedImap = {
	account_id: string; status: string; sync_mode: string; history_id: string | null; baseline_history_id: string | null;
	page_token: string | null; full_sync_generation: string; attempts: number; lease_token: string; workspace_id: string;
};

function limitUtf8(value: string, max: number) {
	const bytes = Buffer.from(value, "utf8");
	try { return bytes.length <= max ? value : bytes.subarray(0, max).toString("utf8"); } finally { bytes.fill(0); }
}

function addresses(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(addresses).slice(0, 200);
	if (!value || typeof value !== "object" || !("text" in value) || typeof value.text !== "string") return [];
	return [value.text.slice(0, 32_768)];
}

async function claimImap(now: Date): Promise<ClaimedImap[]> {
	const lease = randomUUID();
	const idleBefore = new Date(now.getTime() - IDLE_POLL_MS);
	return await getDb().transaction((tx) => tx.execute(sql`
		WITH candidates AS (
			SELECT s.account_id FROM mail_sync_states s JOIN mail_accounts a ON a.id=s.account_id
			WHERE a.provider='imap_smtp' AND a.status='connected' AND (
				s.status='pending' OR (s.status='retry' AND s.next_attempt_at <= ${now.toISOString()}::timestamptz)
				OR (s.status='running' AND s.lease_until < ${now.toISOString()}::timestamptz)
				OR (s.status='idle' AND s.last_success_at <= ${idleBefore.toISOString()}::timestamptz)
			) ORDER BY COALESCE(s.next_attempt_at,s.requested_at,s.created_at),s.account_id
			FOR UPDATE OF s SKIP LOCKED LIMIT 2
		) UPDATE mail_sync_states s SET status='running',lease_token=${lease}::uuid,
			lease_until=${new Date(now.getTime() + 120_000).toISOString()}::timestamptz,last_started_at=${now.toISOString()}::timestamptz,attempts=s.attempts+1
		FROM candidates c,mail_accounts a WHERE s.account_id=c.account_id AND a.id=s.account_id RETURNING s.*,a.workspace_id
	`)) as unknown as ClaimedImap[];
}

async function syncImapPage(state: ClaimedImap) {
	const { credential } = await credentialFor(state.account_id);
	const host = await resolvePublicEndpoint(credential.imap.host);
	const client = imapClient(credential, host);
	await client.connect();
	try {
		const lock = await client.getMailboxLock("INBOX");
		try {
			const mailbox = client.mailbox;
			const uidValidity = String(mailbox ? mailbox.uidValidity : "0");
			const all = await client.search({ all: true }, { uid: true });
			const uids = (Array.isArray(all) ? all : []).filter((uid): uid is number => Number.isInteger(uid) && uid > 0).sort((a, b) => a - b);
			if (uids.length > MAX_UIDS_PER_MAILBOX) throw new Error("mail_contract_rejected");
			const currentMax = uids.at(-1) ?? 0;
			const [storedValidity, storedUidRaw] = (state.history_id ?? "0:0").split(":");
			const storedUid = Number(storedUidRaw ?? 0);
			const full = state.sync_mode === "full" || (state.history_id !== null && storedValidity !== uidValidity);
			const flagState = full ? null : await Promise.all([
				client.search({ seen: false }, { uid: true }),
				client.search({ flagged: true }, { uid: true }),
			]);
			const flagIds = (value: false | number[]) => (Array.isArray(value) ? value : [])
				.filter((uid): uid is number => Number.isInteger(uid) && uid > 0)
				.map((uid) => `imap-${uidValidity}-${uid}`);
			const unseenIds = flagState ? flagIds(flagState[0]) : [];
			const starredIds = flagState ? flagIds(flagState[1]) : [];
			let selected: number[];
			let more = false;
			let nextToken: string | null = null;
			let baseline = state.baseline_history_id ?? `${uidValidity}:${currentMax}`;
			if (full) {
				const upper = Number(state.page_token ?? currentMax);
				const eligible = uids.filter((uid) => uid <= upper);
				selected = eligible.slice(-PAGE_SIZE);
				more = eligible.length > selected.length;
				nextToken = more ? String((selected[0] ?? 1) - 1) : null;
			} else {
				const after = Number(state.page_token ?? storedUid);
				const eligible = uids.filter((uid) => uid > after);
				selected = eligible.slice(0, PAGE_SIZE);
				more = eligible.length > selected.length;
				nextToken = more ? String(selected.at(-1) ?? after) : null;
				baseline = `${uidValidity}:${currentMax}`;
			}
			const prepared: Array<{ uid: number; providerId: string; threadId: string; internalDate: Date; labels: string[]; size: number; content: Record<string, unknown>; truncated: boolean }> = [];
			if (selected.length > 0) for await (const message of client.fetch(selected.join(","), { uid: true, source: true, flags: true, internalDate: true, size: true }, { uid: true })) {
				if (!message.uid || !message.source || message.source.length > MAX_SOURCE_BYTES) throw new Error("mail_contract_rejected");
				let attachments: Array<{ content: Buffer }> = [];
				try {
					const parsed = await simpleParser(message.source, { skipHtmlToText: true, skipTextToHtml: true, maxHtmlLengthToParse: MAX_HTML_BYTES });
					attachments = parsed.attachments;
					const textRaw = typeof parsed.text === "string" ? parsed.text : "";
					const htmlRaw = typeof parsed.html === "string" ? parsed.html : "";
					const textBody = limitUtf8(textRaw, MAX_TEXT_BYTES);
					const htmlBody = limitUtf8(htmlRaw, MAX_HTML_BYTES);
						const providerId = `imap-${uidValidity}-${message.uid}`;
						const root = parsed.inReplyTo ?? parsed.references?.at(-1) ?? parsed.messageId ?? providerId;
						const references = (Array.isArray(parsed.references)
							? parsed.references
							: parsed.references
								? [parsed.references]
								: [])
							.map((value) => value.trim())
							.filter((value) => /^<[^<>\r\n]{1,998}>$/.test(value))
							.slice(-100);
					const flags = message.flags ?? new Set<string>();
					const dateValue = message.internalDate ?? parsed.date;
					const internalDate = dateValue instanceof Date ? dateValue : dateValue ? new Date(dateValue) : null;
					if (!internalDate || Number.isNaN(internalDate.getTime())) throw new Error("mail_contract_rejected");
					prepared.push({ uid: message.uid, providerId, threadId: opaqueId(root), internalDate, labels: ["INBOX", ...(flags.has("\\Seen") ? [] : ["UNREAD"]), ...(flags.has("\\Flagged") ? ["STARRED"] : [])], size: Math.min(message.size ?? message.source.length, 100_000_000), truncated: textBody !== textRaw || htmlBody !== htmlRaw, content: {
						subject: (parsed.subject ?? "").slice(0, 32_768), from: parsed.from?.text?.slice(0, 32_768) ?? "",
						to: addresses(parsed.to), cc: addresses(parsed.cc), replyTo: parsed.replyTo?.text?.slice(0, 32_768) ?? "",
						dateHeader: parsed.date?.toUTCString() ?? "", authenticationResults: String(parsed.headers.get("authentication-results") ?? "").slice(0, 32_768),
							returnPath: String(parsed.headers.get("return-path") ?? "").slice(0, 32_768), messageIdHeader: (parsed.messageId ?? "").slice(0, 32_768),
							references,
						snippet: textBody.replace(/\s+/g, " ").trim().slice(0, 500), textBody, htmlBody,
						attachments: parsed.attachments.slice(0, 256).map((attachment) => ({ filename: attachment.filename?.slice(0, 1024) ?? "", mimeType: attachment.contentType.slice(0, 256), size: attachment.size, attachmentId: null })),
					} });
				} finally {
					for (const attachment of attachments) attachment.content.fill(0);
					message.source.fill(0);
				}
			}
			await getDb().transaction(async (tx) => {
				for (const item of prepared) {
					const encrypted = encryptMailContent({ accountId: state.account_id, provider: "imap_smtp", providerMessageId: item.providerId }, item.content);
					await tx.insert(mailMessages).values({ accountId: state.account_id, providerMessageId: item.providerId, providerThreadId: item.threadId, historyId: `${uidValidity}:${item.uid}`, internalDate: item.internalDate, labelIds: item.labels, sizeEstimate: item.size, ...encrypted, contentTruncated: item.truncated, lastSeenSyncGeneration: state.full_sync_generation }).onConflictDoUpdate({ target: [mailMessages.accountId, mailMessages.providerMessageId], set: { providerThreadId: item.threadId, historyId: `${uidValidity}:${item.uid}`, internalDate: item.internalDate, labelIds: item.labels, sizeEstimate: item.size, ...encrypted, contentVersion: sql`${mailMessages.contentVersion} + 1`, contentTruncated: item.truncated, lastSeenSyncGeneration: state.full_sync_generation } });
				}
				for (const label of [{ id: "INBOX", name: "Doručená pošta" }, { id: "UNREAD", name: "Nepřečtené" }, { id: "STARRED", name: "S hvězdičkou" }]) await tx.insert(mailProviderLabels).values({ accountId: state.account_id, providerLabelId: label.id, name: label.name, kind: "system" }).onConflictDoUpdate({ target: [mailProviderLabels.accountId, mailProviderLabels.providerLabelId], set: { name: label.name, kind: "system" } });
				if (full && !more) {
					await tx.execute(sql`DELETE FROM mail_messages WHERE account_id=${state.account_id} AND last_seen_sync_generation <> ${state.full_sync_generation}::uuid`);
				} else if (!full && !more) {
					// UID SEARCH dává úplný stav INBOXu i bez CONDSTORE. Parametrizované
					// text[] smí odstranit jen zprávy tohoto UIDVALIDITY, které provider
					// skutečně expungoval nebo přesunul z doručené pošty.
					const liveIds = `{${uids.map((uid) => `imap-${uidValidity}-${uid}`).join(",")}}`;
					await tx.execute(sql`DELETE FROM mail_messages
						WHERE account_id=${state.account_id}
						  AND provider_message_id LIKE ${`imap-${uidValidity}-%`}
						  AND NOT (provider_message_id = ANY(${liveIds}::text[]))`);
					const unseen = `{${unseenIds.join(",")}}`;
					const starred = `{${starredIds.join(",")}}`;
					await tx.execute(sql`
						WITH desired AS (
							SELECT id,
								jsonb_build_array('INBOX') ||
								CASE WHEN provider_message_id = ANY(${unseen}::text[]) THEN '["UNREAD"]'::jsonb ELSE '[]'::jsonb END ||
								CASE WHEN provider_message_id = ANY(${starred}::text[]) THEN '["STARRED"]'::jsonb ELSE '[]'::jsonb END AS labels
							FROM mail_messages
							WHERE account_id=${state.account_id} AND provider_message_id LIKE ${`imap-${uidValidity}-%`}
						)
						UPDATE mail_messages message SET label_ids=desired.labels, updated_at=now()
						FROM desired WHERE message.id=desired.id AND message.label_ids IS DISTINCT FROM desired.labels
					`);
				}
				const completedHistory = baseline;
				await tx.update(mailSyncStates).set({ status: more ? "pending" : "idle", syncMode: full && more ? "full" : "partial", historyId: more ? state.history_id : completedHistory, baselineHistoryId: more ? baseline : null, pageToken: nextToken, requestedAt: more ? new Date() : null, nextAttemptAt: null, leaseToken: null, leaseUntil: null, attempts: 0, lastSuccessAt: new Date(), lastErrorCode: null, version: sql`${mailSyncStates.version} + 1` }).where(and(eq(mailSyncStates.accountId, state.account_id), eq(mailSyncStates.leaseToken, state.lease_token)));
				await tx.update(mailAccounts).set({ status: "connected", lastSuccessAt: new Date(), lastErrorCode: null }).where(eq(mailAccounts.id, state.account_id));
				await tx.insert(auditEvents).values({ workspaceId: state.workspace_id, actorType: "system", actorUserId: null, entity: "mail_sync", entityId: state.account_id, action: full && !more ? "full_sync_completed" : "page_synced", diff: { provider: "imap_smtp", upserted: prepared.length, morePages: more } });
			});
		} finally { lock.release(); }
	} finally { await client.logout().catch(() => client.close()); }
}

export async function scanImapSync(now = new Date()) {
	const jobs = await claimImap(now);
	for (const state of jobs) try { await syncImapPage(state); } catch (error) {
		const message = error instanceof Error ? error.message : "mail_provider_unavailable";
		const auth = authenticationFailure(error);
		const terminal = auth || state.attempts >= 5 || message === "mail_contract_rejected";
		await getDb().transaction(async (tx) => {
			await tx.update(mailSyncStates).set({ status: auth ? "reauth_required" : terminal ? "dead" : "retry", leaseToken: null, leaseUntil: null, requestedAt: null, nextAttemptAt: terminal ? null : new Date(Date.now() + Math.min(2 ** state.attempts, 60) * 60_000), lastErrorCode: auth ? "mail_auth_rejected" : message === "mail_contract_rejected" ? message : "mail_provider_unavailable", version: sql`${mailSyncStates.version} + 1` }).where(and(eq(mailSyncStates.accountId, state.account_id), eq(mailSyncStates.leaseToken, state.lease_token)));
			await tx.update(mailAccounts).set({ status: auth ? "reauth_required" : "degraded", lastErrorAt: new Date(), lastErrorCode: auth ? "mail_credentials_invalid" : message === "mail_contract_rejected" ? message : "mail_provider_unavailable" }).where(eq(mailAccounts.id, state.account_id));
		});
	}
	return jobs.length;
}

export async function sendImapSmtpMessage(accountId: string, outboundId: string, content: OutboundContent) {
	const { account, credential } = await credentialFor(accountId);
	const host = await resolvePublicEndpoint(credential.smtp.host);
	const transporter = smtpTransport(credential, host);
	const messageId = `<watson-${outboundId}@watson.invalid>`;
	try {
		const response = await transporter.sendMail({ from: account.emailAddress, to: content.to, cc: content.cc, bcc: content.bcc, subject: content.subject, text: content.textBody, messageId, inReplyTo: content.inReplyTo ?? undefined, references: content.references });
		return { id: opaqueId(String(response.messageId ?? messageId)), threadId: opaqueId(content.inReplyTo ?? content.references?.at(-1) ?? messageId) };
	} finally { transporter.close(); }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startMailImapWorker(intervalMs = 10_000) {
	if (timer) return;
	timer = setInterval(() => void scanImapSync().catch((error) => console.error(JSON.stringify({ level: "error", event: "mail_imap_scan_failed", name: error instanceof Error ? error.name : "UnknownError" }))), intervalMs);
	console.log(`[mail-imap] worker běží (interval ${intervalMs / 1000}s)`);
}
