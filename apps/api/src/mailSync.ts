/**
 * F5 Mail M1 — owner-isolated Gmail full/incremental synchronization.
 *
 * The worker stores only opaque provider IDs and scheduling metadata in clear.
 * Headers, addresses, snippets and MIME bodies are authenticated ciphertext.
 * Full sync is paged, partial sync uses Gmail historyId, and an expired history
 * cursor deterministically falls back to a new full generation.
 */
import { randomUUID } from "node:crypto";
import {
	and,
	auditEvents,
	desc,
	eq,
	getDb,
	inArray,
	mailAccountCredentials,
	mailAccounts,
	mailMessages,
	mailProviderLabels,
	mailSyncStates,
	ne,
	sql,
} from "@watson/db";
import { Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";
import { env, mailGoogleEnabled } from "./env";
import { decryptMailContent, encryptMailContent } from "./mailContentVault";
import {
	decryptMailSecret,
	encryptMailSecret,
	type MailVaultContext,
	type MailVaultEnvelope,
	parseMailVaultKeyring,
} from "./mailVault";

export const mailSyncRoutes = new Hono<{ Variables: { requestId: string } }>();

const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const PROVIDER_TIMEOUT_MS = 10_000;
const PROVIDER_JSON_LIMIT = 4 * 1024 * 1024;
const PAGE_SIZE = 25;
const IDLE_POLL_INTERVAL_MS = 60_000;
const MAX_TEXT_BODY_BYTES = 256 * 1024;
const MAX_HTML_BODY_BYTES = 512 * 1024;
const MAX_PARTS = 256;

const googleCredentialSchema = z.object({
	purpose: z.literal("google_mailbox"),
	accessToken: z.string().min(16).max(8192),
	refreshToken: z.string().min(16).max(8192),
	expiresAt: z.string().datetime({ offset: true }),
	tokenType: z.string().min(1).max(32),
	grantedScopes: z.array(z.string().min(1).max(512)).min(1).max(32),
});
const refreshSchema = z
	.object({
		access_token: z.string().min(16).max(8192),
		expires_in: z.number().int().positive().max(86_400),
		token_type: z.string().min(1).max(32),
		scope: z.string().min(1).max(4096).optional(),
		refresh_token: z.string().min(16).max(8192).optional(),
	})
	.passthrough();
const messageRefSchema = z.object({
	id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
	threadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
});
const messageListSchema = z
	.object({
		messages: z.array(messageRefSchema).max(PAGE_SIZE).optional().default([]),
		nextPageToken: z.string().min(1).max(2048).optional(),
		resultSizeEstimate: z.number().int().nonnegative().optional(),
	})
	.passthrough();
const headerSchema = z.object({
	name: z.string().min(1).max(256),
	value: z.string().max(32_768),
});
type GmailPart = {
	partId?: string;
	mimeType?: string;
	filename?: string;
	headers?: z.infer<typeof headerSchema>[];
	body?: { attachmentId?: string; size?: number; data?: string };
	parts?: GmailPart[];
};
const partSchema: z.ZodType<GmailPart> = z.lazy(() =>
	z
		.object({
			partId: z.string().max(128).optional(),
			mimeType: z.string().max(256).optional(),
			filename: z.string().max(1024).optional(),
			headers: z.array(headerSchema).max(200).optional(),
			body: z
				.object({
					attachmentId: z.string().max(1024).optional(),
					size: z.number().int().nonnegative().max(100_000_000).optional(),
					data: z.string().max(5_600_000).optional(),
				})
				.passthrough()
				.optional(),
			parts: z.array(partSchema).max(200).optional(),
		})
		.passthrough(),
);
const gmailMessageSchema = z
	.object({
		id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
		threadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
		labelIds: z.array(z.string().min(1).max(256)).max(256).optional().default([]),
		snippet: z.string().max(32_768).optional().default(""),
		historyId: z.string().regex(/^[0-9]{1,64}$/),
		internalDate: z.string().regex(/^[0-9]{1,20}$/),
		sizeEstimate: z.number().int().nonnegative().max(100_000_000).optional().default(0),
		payload: partSchema,
	})
	.passthrough();
const profileSchema = z.object({ historyId: z.string().regex(/^[0-9]{1,64}$/) }).passthrough();
const providerLabelSchema = z.object({
	id: z.string().min(1).max(256),
	name: z.string().min(1).max(256),
	type: z.enum(["system", "user"]).optional().default("user"),
	color: z.object({ backgroundColor: z.string().max(32).optional() }).optional(),
}).passthrough();
const providerLabelsSchema = z.object({ labels: z.array(providerLabelSchema).max(1000).default([]) }).passthrough();
const historyMessageSchema = z.object({
	id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
	threadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
});
const historyEntrySchema = z
	.object({
		id: z.string().regex(/^[0-9]{1,64}$/),
		messagesAdded: z.array(z.object({ message: historyMessageSchema })).max(500).optional(),
		messagesDeleted: z.array(z.object({ message: historyMessageSchema })).max(500).optional(),
		labelsAdded: z.array(z.object({ message: historyMessageSchema })).max(500).optional(),
		labelsRemoved: z.array(z.object({ message: historyMessageSchema })).max(500).optional(),
	})
	.passthrough();
const historyListSchema = z
	.object({
		history: z.array(historyEntrySchema).max(500).optional().default([]),
		nextPageToken: z.string().min(1).max(2048).optional(),
		historyId: z.string().regex(/^[0-9]{1,64}$/),
	})
	.passthrough();
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
	snippet: z.string().max(32_768),
	textBody: z.string().max(MAX_TEXT_BODY_BYTES),
	htmlBody: z.string().max(MAX_HTML_BODY_BYTES),
	attachments: z.array(attachmentSchema).max(MAX_PARTS),
});
type StoredContent = z.infer<typeof storedContentSchema>;

function addressDomain(value: string): string | null {
	const match = /@([a-z0-9.-]+)(?:>|\s|$)/i.exec(value.trim());
	return match?.[1]?.replace(/\.$/, "").toLowerCase() ?? null;
}

/** Vysvětlitelné, konzervativní varování; nikdy netvrdí, že zpráva je bezpečná. */
function assessSenderIdentity(input: {
	from: string;
	replyTo: string;
	returnPath: string;
	authenticationResults: string;
	messageIdHeader: string;
}) {
	const auth = input.authenticationResults.toLowerCase();
	const fromDomain = addressDomain(input.from);
	const replyDomain = addressDomain(input.replyTo);
	const returnDomain = addressDomain(input.returnPath);
	const reasons: string[] = [];
	const dmarcFail = /\bdmarc\s*=\s*(?:fail|temperror|permerror)\b/.test(auth);
	const spfFail = /\bspf\s*=\s*(?:fail|softfail|temperror|permerror)\b/.test(auth);
	const dkimFail = /\bdkim\s*=\s*(?:fail|temperror|permerror)\b/.test(auth);
	const dmarcPass = /\bdmarc\s*=\s*pass\b/.test(auth);
	const spfPass = /\bspf\s*=\s*pass\b/.test(auth);
	const dkimPass = /\bdkim\s*=\s*pass\b/.test(auth);
	if (dmarcFail) reasons.push("Ověření DMARC odesílatele selhalo.");
	if (spfFail && dkimFail) reasons.push("Selhalo SPF i DKIM ověření.");
	if (fromDomain && replyDomain && fromDomain !== replyDomain) {
		reasons.push(`Odpověď míří na jinou doménu (${replyDomain}).`);
	}
	if (fromDomain?.startsWith("xn--") || fromDomain?.includes(".xn--")) {
		reasons.push("Doména používá mezinárodní punycode; zkontroluj její zápis.");
	}
	const high = dmarcFail || (spfFail && dkimFail);
	const medium = !high && reasons.length > 0;
	return {
		level: high ? "danger" : medium ? "warning" : dmarcPass || (spfPass && dkimPass) ? "verified" : "unknown",
		reasons,
		fromDomain,
		replyDomain,
		returnDomain,
		authentication: {
			spf: spfPass ? "pass" : spfFail ? "fail" : "unknown",
			dkim: dkimPass ? "pass" : dkimFail ? "fail" : "unknown",
			dmarc: dmarcPass ? "pass" : dmarcFail ? "fail" : "unknown",
		},
	};
}

class MailSyncError extends Error {
	constructor(
		readonly code:
			| "mail_provider_timeout"
			| "mail_provider_unavailable"
			| "mail_rate_limited"
			| "mail_auth_rejected"
			| "mail_contract_rejected"
			| "mail_history_expired"
			| "mail_account_inactive",
		readonly retryable: boolean,
		readonly stage = "unspecified",
		options?: ErrorOptions,
	) {
		super(code, options);
	}
}

type ClaimedState = {
	account_id: string;
	workspace_id: string;
	owner_user_id: string;
	status: string;
	sync_mode: "full" | "partial";
	history_id: string | null;
	baseline_history_id: string | null;
	page_token: string | null;
	full_sync_generation: string;
	lease_token: string;
	attempts: number;
};

function envelopeFrom(row: {
	algorithm: string;
	keyId: string;
	nonce: string;
	authTag: string;
	ciphertext: string;
}): MailVaultEnvelope {
	if (row.algorithm !== "aes-256-gcm-v1") throw new MailSyncError("mail_contract_rejected", false);
	return {
		algorithm: "aes-256-gcm-v1",
		keyId: row.keyId,
		nonce: row.nonce,
		authTag: row.authTag,
		ciphertext: row.ciphertext,
	};
}

async function providerFetch(url: string, init: RequestInit): Promise<Response> {
	try {
		return await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
	} catch (error) {
		if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
			throw new MailSyncError("mail_provider_timeout", true);
		}
		throw new MailSyncError("mail_provider_unavailable", true);
	}
}

export async function readMailProviderJson(
	response: Response,
	maxBytes = PROVIDER_JSON_LIMIT,
): Promise<unknown> {
	const declared = Number(response.headers.get("content-length") ?? "0");
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw new MailSyncError("mail_contract_rejected", false);
	}
	if (!response.body) throw new MailSyncError("mail_contract_rejected", false);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			total += next.value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				throw new MailSyncError("mail_contract_rejected", false);
			}
			chunks.push(next.value);
		}
		const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
		for (const chunk of chunks) chunk.fill(0);
		try {
			return JSON.parse(body.toString("utf8"));
		} finally {
			body.fill(0);
		}
	} catch (error) {
		if (error instanceof MailSyncError) throw error;
		throw new MailSyncError("mail_contract_rejected", false);
	}
}

async function credentialRow(accountId: string) {
	return (
		await getDb()
			.select({
				accountId: mailAccounts.id,
				ownerUserId: mailAccounts.ownerUserId,
				status: mailAccounts.status,
				algorithm: mailAccountCredentials.algorithm,
				keyId: mailAccountCredentials.keyId,
				nonce: mailAccountCredentials.nonce,
				authTag: mailAccountCredentials.authTag,
				ciphertext: mailAccountCredentials.ciphertext,
				credentialVersion: mailAccountCredentials.credentialVersion,
			})
			.from(mailAccounts)
			.innerJoin(mailAccountCredentials, eq(mailAccountCredentials.accountId, mailAccounts.id))
			.where(and(eq(mailAccounts.id, accountId), eq(mailAccounts.provider, "google")))
			.limit(1)
	)[0];
}

async function markReauthRequired(accountId: string) {
	await getDb().transaction(async (tx) => {
		await tx
			.update(mailAccounts)
			.set({ status: "reauth_required", lastErrorCode: "mail_token_expired", lastErrorAt: new Date() })
			.where(eq(mailAccounts.id, accountId));
		await tx
			.update(mailSyncStates)
			.set({
				status: "reauth_required",
				leaseToken: null,
				leaseUntil: null,
				requestedAt: null,
				nextAttemptAt: null,
				lastErrorCode: "mail_auth_rejected",
			})
			.where(eq(mailSyncStates.accountId, accountId));
	});
}

async function accessToken(accountId: string, forceRefresh = false, depth = 0): Promise<string> {
	const row = await credentialRow(accountId);
	if (row?.status !== "connected") throw new MailSyncError("mail_account_inactive", false);
	const context: MailVaultContext = {
		accountId,
		ownerUserId: row.ownerUserId,
		provider: "google",
		secretKind: "google_oauth",
	};
	let credential: z.infer<typeof googleCredentialSchema>;
	try {
		credential = googleCredentialSchema.parse(
			decryptMailSecret(
				context,
				envelopeFrom({
					algorithm: row.algorithm,
					keyId: row.keyId,
					nonce: row.nonce,
					authTag: row.authTag,
					ciphertext: row.ciphertext,
				}),
			),
		);
	} catch {
		throw new MailSyncError("mail_contract_rejected", false);
	}
	if (!forceRefresh && new Date(credential.expiresAt).getTime() > Date.now() + 120_000) {
		const activeKeyId = parseMailVaultKeyring(env.mailVaultKeysJson).currentKid;
		if (row.keyId !== activeKeyId) {
			const encrypted = encryptMailSecret(context, credential);
			const rotated = await getDb()
				.update(mailAccountCredentials)
				.set({
					...encrypted,
					credentialVersion: sql`${mailAccountCredentials.credentialVersion} + 1`,
				})
				.where(
					and(
						eq(mailAccountCredentials.accountId, accountId),
						eq(mailAccountCredentials.credentialVersion, row.credentialVersion),
					),
				)
				.returning({ accountId: mailAccountCredentials.accountId });
			if (rotated.length === 0 && depth < 1) return accessToken(accountId, false, depth + 1);
			if (rotated.length === 0) throw new MailSyncError("mail_provider_unavailable", true);
		}
		return credential.accessToken;
	}
	const response = await providerFetch(env.mailGoogle.tokenUrl, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env.mailGoogle.clientId ?? "",
			client_secret: env.mailGoogle.clientSecret ?? "",
			grant_type: "refresh_token",
			refresh_token: credential.refreshToken,
		}),
	});
	if (!response.ok) {
		if (response.status === 400 || response.status === 401) {
			await markReauthRequired(accountId);
			throw new MailSyncError("mail_auth_rejected", false);
		}
		throw new MailSyncError(response.status === 429 ? "mail_rate_limited" : "mail_provider_unavailable", true);
	}
	const parsed = refreshSchema.safeParse(await readMailProviderJson(response, 128 * 1024));
	if (!parsed.success) throw new MailSyncError("mail_contract_rejected", false);
	const grantedScopes = parsed.data.scope
		? [...new Set(parsed.data.scope.split(/\s+/).filter(Boolean))].sort()
		: credential.grantedScopes;
	if (!grantedScopes.includes(GMAIL_MODIFY_SCOPE)) {
		await markReauthRequired(accountId);
		throw new MailSyncError("mail_auth_rejected", false);
	}
	const nextCredential = {
		...credential,
		accessToken: parsed.data.access_token,
		refreshToken: parsed.data.refresh_token ?? credential.refreshToken,
		expiresAt: new Date(Date.now() + parsed.data.expires_in * 1000).toISOString(),
		tokenType: parsed.data.token_type,
		grantedScopes,
	};
	const encrypted = encryptMailSecret(context, nextCredential);
	const updated = await getDb()
		.update(mailAccountCredentials)
		.set({
			...encrypted,
			credentialVersion: sql`${mailAccountCredentials.credentialVersion} + 1`,
		})
		.where(
			and(
				eq(mailAccountCredentials.accountId, accountId),
				eq(mailAccountCredentials.credentialVersion, row.credentialVersion),
			),
		)
		.returning({ accountId: mailAccountCredentials.accountId });
	if (updated.length === 0 && depth < 1) return accessToken(accountId, false, depth + 1);
	if (updated.length === 0) throw new MailSyncError("mail_provider_unavailable", true);
	return parsed.data.access_token;
}

/**
 * Sdílený owner-mailbox transport pro inbound i outbound Gmail cesty.
 * Každý request dostane čerstvý server-only bearer; po 401 proběhne právě jeden
 * refresh. Volající stále musí validovat konkrétní provider response kontrakt.
 */
export async function authenticatedGoogleMailFetch(
	accountId: string,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	let token = await accessToken(accountId);
	const request = (access: string) => {
		const headers = new Headers(init.headers);
		headers.set("Authorization", `Bearer ${access}`);
		headers.set("Accept", "application/json");
		return providerFetch(`${env.mailGoogle.apiBaseUrl}${path}`, { ...init, headers });
	};
	let response = await request(token);
	if (response.status === 401) {
		token = await accessToken(accountId, true);
		response = await request(token);
	}
	return response;
}

async function googleFetch(accountId: string, path: string): Promise<Response> {
	return authenticatedGoogleMailFetch(accountId, path);
}

function providerError(response: Response, historyRequest = false): never {
	if (historyRequest && response.status === 404) {
		throw new MailSyncError("mail_history_expired", false);
	}
	if (response.status === 401 || response.status === 403) {
		throw new MailSyncError("mail_auth_rejected", false);
	}
	if (response.status === 429) throw new MailSyncError("mail_rate_limited", true);
	throw new MailSyncError("mail_provider_unavailable", response.status >= 500);
}

function maxHistory(...values: Array<string | null | undefined>): string | null {
	let max: bigint | null = null;
	for (const value of values) {
		if (!value || !/^[0-9]{1,64}$/.test(value)) continue;
		const parsed = BigInt(value);
		if (max === null || parsed > max) max = parsed;
	}
	return max?.toString() ?? null;
}

function cleanText(value: string): string {
	return value.replaceAll("\0", "").replace(/\r\n?/g, "\n");
}

function decodePart(data: string, mimeType: string): string {
	const bytes = Buffer.from(data, "base64url");
	const charset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(mimeType)?.[1] ?? "utf-8";
	try {
		return cleanText(new TextDecoder(charset, { fatal: false }).decode(bytes));
	} catch {
		return cleanText(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
	} finally {
		bytes.fill(0);
	}
}

function parseMessage(message: z.infer<typeof gmailMessageSchema>): {
	content: StoredContent;
	truncated: boolean;
} {
	const headers = new Map<string, string[]>();
	for (const header of message.payload.headers ?? []) {
		const key = header.name.trim().toLowerCase();
		const current = headers.get(key) ?? [];
		if (current.length < 200) current.push(cleanText(header.value).slice(0, 32_768));
		headers.set(key, current);
	}
	const textParts: string[] = [];
	const htmlParts: string[] = [];
	const attachments: StoredContent["attachments"] = [];
	let partCount = 0;
	let truncated = false;
	const visit = (part: GmailPart, depth: number) => {
		partCount += 1;
		if (partCount > MAX_PARTS || depth > 12) {
			truncated = true;
			return;
		}
		const mimeType = (part.mimeType ?? "application/octet-stream").slice(0, 256);
		const filename = cleanText(part.filename ?? "").slice(0, 1024);
		if (filename || part.body?.attachmentId) {
			attachments.push({
				filename,
				mimeType,
				size: part.body?.size ?? 0,
				attachmentId: part.body?.attachmentId?.slice(0, 1024) ?? null,
			});
		}
		if (!filename && part.body?.data) {
			const decoded = decodePart(part.body.data, mimeType);
			if (mimeType.toLowerCase().startsWith("text/plain")) textParts.push(decoded);
			if (mimeType.toLowerCase().startsWith("text/html")) htmlParts.push(decoded);
		}
		for (const child of part.parts ?? []) visit(child, depth + 1);
	};
	visit(message.payload, 0);
	const joinLimited = (parts: string[], maxBytes: number) => {
		let value = parts.join("\n\n");
		const bytes = Buffer.from(value, "utf8");
		if (bytes.length > maxBytes) {
			truncated = true;
			value = bytes.subarray(0, maxBytes).toString("utf8");
		}
		bytes.fill(0);
		return value;
	};
	// Address headers remain RFC-shaped lines. Splitting on comma would corrupt
	// quoted display names ("Doe, Jane" <jane@example.com>).
	const addressHeaders = (key: string) => (headers.get(key) ?? []).slice(0, 200);
	return {
		content: {
			subject: headers.get("subject")?.[0] ?? "",
			from: headers.get("from")?.[0] ?? "",
			to: addressHeaders("to"),
			cc: addressHeaders("cc"),
			replyTo: headers.get("reply-to")?.[0] ?? "",
			dateHeader: headers.get("date")?.[0] ?? "",
			authenticationResults: (headers.get("authentication-results") ?? []).join("\n").slice(0, 32_768),
			returnPath: headers.get("return-path")?.[0] ?? "",
			messageIdHeader: headers.get("message-id")?.[0] ?? "",
			snippet: cleanText(message.snippet),
			textBody: joinLimited(textParts, MAX_TEXT_BODY_BYTES),
			htmlBody: joinLimited(htmlParts, MAX_HTML_BODY_BYTES),
			attachments: attachments.slice(0, MAX_PARTS),
		},
		truncated,
	};
}

async function fetchMessage(accountId: string, messageId: string) {
	const response = await googleFetch(
		accountId,
		`/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=FULL`,
	);
	if (response.status === 404) return null;
	if (!response.ok) providerError(response);
	const parsed = gmailMessageSchema.safeParse(await readMailProviderJson(response));
	if (!parsed.success || parsed.data.id !== messageId) {
		throw new MailSyncError("mail_contract_rejected", false);
	}
	return parsed.data;
}

async function mapLimited<T, R>(values: T[], limit: number, run: (value: T) => Promise<R>) {
	const result: R[] = new Array(values.length);
	let cursor = 0;
	const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
		while (cursor < values.length) {
			const index = cursor;
			cursor += 1;
			result[index] = await run(values[index] as T);
		}
	});
	await Promise.all(workers);
	return result;
}

async function persistPage(
	state: ClaimedState,
	messages: Array<z.infer<typeof gmailMessageSchema>>,
	deletedIds: string[],
	next: {
		mode: "full" | "partial";
		pageToken: string | null;
		baselineHistoryId: string;
		finishedFull: boolean;
	},
) {
	const prepared = messages.map((message) => {
		const parsed = parseMessage(message);
		const envelope = encryptMailContent(
			{ accountId: state.account_id, provider: "google", providerMessageId: message.id },
			parsed.content,
		);
		return { message, parsed, envelope };
	});
	const now = new Date();
	const activeKeyId = parseMailVaultKeyring(env.mailVaultKeysJson).currentKid;
	await getDb().transaction(async (tx) => {
		const active = (await tx.execute(sql`
			SELECT id FROM mail_accounts
			WHERE id = ${state.account_id} AND provider = 'google' AND status = 'connected'
			FOR UPDATE
		`)) as unknown as Array<{ id: string }>;
		if (!active[0]) throw new MailSyncError("mail_account_inactive", false);
		for (const item of prepared) {
			const internalDate = new Date(Number(item.message.internalDate));
			if (Number.isNaN(internalDate.getTime())) throw new MailSyncError("mail_contract_rejected", false);
			await tx
				.insert(mailMessages)
				.values({
					accountId: state.account_id,
					providerMessageId: item.message.id,
					providerThreadId: item.message.threadId,
					historyId: item.message.historyId,
					internalDate,
					labelIds: [...new Set(item.message.labelIds)].sort(),
					sizeEstimate: item.message.sizeEstimate,
					...item.envelope,
					contentTruncated: item.parsed.truncated,
					lastSeenSyncGeneration: state.full_sync_generation,
				})
				.onConflictDoUpdate({
					target: [mailMessages.accountId, mailMessages.providerMessageId],
					set: {
						providerThreadId: item.message.threadId,
						historyId: item.message.historyId,
						internalDate,
						labelIds: [...new Set(item.message.labelIds)].sort(),
						sizeEstimate: item.message.sizeEstimate,
						...item.envelope,
						contentVersion: sql`${mailMessages.contentVersion} + 1`,
						contentTruncated: item.parsed.truncated,
						lastSeenSyncGeneration: state.full_sync_generation,
					},
				});
		}
		if (deletedIds.length > 0) {
			await tx
				.delete(mailMessages)
				.where(
					and(
						eq(mailMessages.accountId, state.account_id),
						inArray(mailMessages.providerMessageId, deletedIds),
					),
				);
		}
		if (next.finishedFull) {
			await tx.execute(sql`
				DELETE FROM mail_messages
				WHERE account_id = ${state.account_id}
				  AND last_seen_sync_generation <> ${state.full_sync_generation}::uuid
			`);
		}
		const oldKeyRows = await tx
			.select()
			.from(mailMessages)
			.where(
				and(
					eq(mailMessages.accountId, state.account_id),
					ne(mailMessages.keyId, activeKeyId),
				),
			)
			.limit(PAGE_SIZE);
		for (const row of oldKeyRows) {
			const content = storedContentSchema.parse(
				decryptMailContent(
					{ accountId: state.account_id, provider: "google", providerMessageId: row.providerMessageId },
					envelopeFrom(row),
				),
			);
			const envelope = encryptMailContent(
				{ accountId: state.account_id, provider: "google", providerMessageId: row.providerMessageId },
				content,
			);
			await tx
				.update(mailMessages)
				.set({
					...envelope,
					contentVersion: sql`${mailMessages.contentVersion} + 1`,
					updatedAt: now,
				})
				.where(
					and(
						eq(mailMessages.id, row.id),
						eq(mailMessages.contentVersion, row.contentVersion),
					),
				);
		}
		const statePatch = next.finishedFull
			? {
					status: "pending",
					syncMode: "partial",
					historyId: next.baselineHistoryId,
					baselineHistoryId: null,
					pageToken: null,
					requestedAt: now,
					nextAttemptAt: null,
					leaseToken: null,
					leaseUntil: null,
					attempts: 0,
					lastSuccessAt: now,
					lastErrorCode: null,
					version: sql`${mailSyncStates.version} + 1`,
				}
			: {
					status: next.pageToken ? "pending" : "idle",
					syncMode: next.mode,
					historyId: next.mode === "partial" && !next.pageToken ? next.baselineHistoryId : state.history_id,
					baselineHistoryId: next.pageToken ? next.baselineHistoryId : null,
					pageToken: next.pageToken,
					requestedAt: next.pageToken ? now : null,
					nextAttemptAt: null,
					leaseToken: null,
					leaseUntil: null,
					attempts: 0,
					lastSuccessAt: now,
					lastErrorCode: null,
					version: sql`${mailSyncStates.version} + 1`,
				};
		const updated = await tx
			.update(mailSyncStates)
			.set(statePatch)
			.where(
				and(
					eq(mailSyncStates.accountId, state.account_id),
					eq(mailSyncStates.leaseToken, state.lease_token),
				),
			)
			.returning({ accountId: mailSyncStates.accountId });
		if (updated.length !== 1) throw new MailSyncError("mail_account_inactive", false);
		await tx.insert(auditEvents).values({
			workspaceId: state.workspace_id,
			actorType: "system",
			actorUserId: null,
			entity: "mail_sync",
			entityId: state.account_id,
			action: next.finishedFull ? "full_sync_completed" : "page_synced",
				diff: {
				provider: "google",
				mode: state.sync_mode,
				upserted: messages.length,
					deleted: deletedIds.length,
					rewrapped: oldKeyRows.length,
				morePages: Boolean(next.pageToken),
			},
		});
	});
}

async function fullSyncPage(state: ClaimedState) {
	if (!state.page_token) {
		const labelsResponse = await googleFetch(state.account_id, "/gmail/v1/users/me/labels");
		if (!labelsResponse.ok) providerError(labelsResponse);
		const labels = providerLabelsSchema.safeParse(await readMailProviderJson(labelsResponse, 512 * 1024));
		if (!labels.success) throw new MailSyncError("mail_contract_rejected", false, "labels");
		await getDb().transaction(async (tx) => {
			for (const label of labels.data.labels) {
				await tx.insert(mailProviderLabels).values({
					accountId: state.account_id,
					providerLabelId: label.id,
					name: label.name,
					kind: label.type,
					color: label.color?.backgroundColor ?? null,
				}).onConflictDoUpdate({
					target: [mailProviderLabels.accountId, mailProviderLabels.providerLabelId],
					set: { name: label.name, kind: label.type, color: label.color?.backgroundColor ?? null },
				});
			}
		});
	}
	const query = new URLSearchParams({ maxResults: String(PAGE_SIZE), includeSpamTrash: "false" });
	if (state.page_token) query.set("pageToken", state.page_token);
	const response = await googleFetch(
		state.account_id,
		`/gmail/v1/users/me/messages?${query.toString()}`,
	);
	if (!response.ok) providerError(response);
	const list = messageListSchema.safeParse(await readMailProviderJson(response, 512 * 1024));
	if (!list.success) throw new MailSyncError("mail_contract_rejected", false);
	const fetched = await mapLimited(list.data.messages, 4, (message) =>
		fetchMessage(state.account_id, message.id),
	);
	const messages = fetched.filter((message): message is z.infer<typeof gmailMessageSchema> => Boolean(message));
	let baseline = maxHistory(state.baseline_history_id, ...messages.map((message) => message.historyId));
	if (!baseline) {
		const profileResponse = await googleFetch(state.account_id, "/gmail/v1/users/me/profile");
		if (!profileResponse.ok) providerError(profileResponse);
		const profile = profileSchema.safeParse(await readMailProviderJson(profileResponse, 128 * 1024));
		if (!profile.success) throw new MailSyncError("mail_contract_rejected", false);
		baseline = profile.data.historyId;
	}
	await persistPage(
		state,
		messages,
		list.data.messages.filter((_, index) => fetched[index] === null).map((message) => message.id),
		{
			mode: "full",
			pageToken: list.data.nextPageToken ?? null,
			baselineHistoryId: baseline,
			finishedFull: !list.data.nextPageToken,
		},
	);
}

async function partialSyncPage(state: ClaimedState) {
	let stage = "cursor_validation";
	try {
		if (!state.history_id) throw new MailSyncError("mail_contract_rejected", false, stage);
		stage = "history_fetch";
		const query = new URLSearchParams({ startHistoryId: state.history_id, maxResults: "500" });
		if (state.page_token) query.set("pageToken", state.page_token);
		const response = await googleFetch(
			state.account_id,
			`/gmail/v1/users/me/history?${query.toString()}`,
		);
		if (!response.ok) providerError(response, true);
		stage = "history_contract";
		const history = historyListSchema.safeParse(await readMailProviderJson(response));
		if (!history.success) throw new MailSyncError("mail_contract_rejected", false, stage);
		stage = "history_collect";
		const changed = new Set<string>();
		const deleted = new Set<string>();
		const enforceHistoryBound = () => {
			if (changed.size + deleted.size > 500) {
				// A bounded worker must not turn one provider page into an unbounded fan-out.
				// A new full generation is slower but complete and deterministic.
				throw new MailSyncError("mail_history_expired", false, stage);
			}
		};
		for (const entry of history.data.history) {
			for (const event of entry.messagesAdded ?? []) {
				changed.add(event.message.id);
				enforceHistoryBound();
			}
			for (const event of entry.labelsAdded ?? []) {
				changed.add(event.message.id);
				enforceHistoryBound();
			}
			for (const event of entry.labelsRemoved ?? []) {
				changed.add(event.message.id);
				enforceHistoryBound();
			}
			for (const event of entry.messagesDeleted ?? []) {
				deleted.add(event.message.id);
				changed.delete(event.message.id);
				enforceHistoryBound();
			}
		}
		for (const id of deleted) changed.delete(id);
		stage = "message_fetch";
		const ids = [...changed];
		const fetched = await mapLimited(ids, 4, (id) => fetchMessage(state.account_id, id));
		const messages = fetched.filter((message): message is z.infer<typeof gmailMessageSchema> => Boolean(message));
		const missing = ids.filter((_, index) => fetched[index] === null);
		stage = "page_persist";
		await persistPage(state, messages, [...deleted, ...missing], {
			mode: "partial",
			pageToken: history.data.nextPageToken ?? null,
			baselineHistoryId: history.data.historyId,
			finishedFull: false,
		});
	} catch (error) {
		if (error instanceof MailSyncError && error.stage !== "unspecified") throw error;
		throw new MailSyncError(
			error instanceof MailSyncError ? error.code : "mail_contract_rejected",
			error instanceof MailSyncError && error.retryable,
			stage,
			{ cause: error },
		);
	}
}

async function resetExpiredHistory(state: ClaimedState) {
	const generation = randomUUID();
	await getDb().transaction(async (tx) => {
		const updated = await tx
			.update(mailSyncStates)
			.set({
				status: "pending",
				syncMode: "full",
				historyId: null,
				baselineHistoryId: null,
				pageToken: null,
				fullSyncGeneration: generation,
				requestedAt: new Date(),
				nextAttemptAt: null,
				leaseToken: null,
				leaseUntil: null,
				attempts: 0,
				lastErrorCode: "mail_history_expired",
				version: sql`${mailSyncStates.version} + 1`,
			})
			.where(and(eq(mailSyncStates.accountId, state.account_id), eq(mailSyncStates.leaseToken, state.lease_token)))
			.returning({ id: mailSyncStates.accountId });
		if (updated.length !== 1) return;
		await tx.insert(auditEvents).values({
			workspaceId: state.workspace_id,
			actorType: "system",
			actorUserId: null,
			entity: "mail_sync",
			entityId: state.account_id,
			action: "history_expired_full_sync_required",
			diff: { provider: "google", recovery: "full_sync" },
		});
	});
}

async function failClaim(state: ClaimedState, error: MailSyncError) {
	if (error.code === "mail_history_expired") return resetExpiredHistory(state);
	if (error.code === "mail_account_inactive") return;
	const reauth = error.code === "mail_auth_rejected";
	const dead = !error.retryable || state.attempts >= 5;
	const delayMinutes = Math.min(2 ** Math.max(0, state.attempts - 1), 60);
	await getDb()
		.update(mailSyncStates)
		.set({
			status: reauth ? "reauth_required" : dead ? "dead" : "retry",
			leaseToken: null,
			leaseUntil: null,
			requestedAt: null,
			nextAttemptAt: reauth || dead ? null : new Date(Date.now() + delayMinutes * 60_000),
			lastErrorCode: error.code,
			version: sql`${mailSyncStates.version} + 1`,
		})
		.where(and(eq(mailSyncStates.accountId, state.account_id), eq(mailSyncStates.leaseToken, state.lease_token)));
	if (reauth) await markReauthRequired(state.account_id);
}

async function claimSyncJobs(now: Date, limit = 3): Promise<ClaimedState[]> {
	const leaseToken = randomUUID();
	const idleBefore = new Date(now.getTime() - IDLE_POLL_INTERVAL_MS);
	const rows = await getDb().transaction((tx) =>
		tx.execute(sql`
			WITH candidates AS (
				SELECT s.account_id
				FROM mail_sync_states s
				JOIN mail_accounts a ON a.id = s.account_id
				WHERE a.provider = 'google' AND a.status = 'connected'
				  AND (
					(s.status = 'pending')
					OR (s.status = 'retry' AND s.next_attempt_at <= ${now.toISOString()}::timestamptz)
					OR (s.status = 'running' AND s.lease_until < ${now.toISOString()}::timestamptz)
					OR (s.status = 'idle' AND s.last_success_at <= ${idleBefore.toISOString()}::timestamptz)
				  )
				ORDER BY COALESCE(s.next_attempt_at, s.requested_at, s.created_at), s.account_id
				FOR UPDATE OF s SKIP LOCKED
				LIMIT ${limit}
			)
			UPDATE mail_sync_states s
			SET status = 'running', lease_token = ${leaseToken}::uuid,
			    lease_until = ${new Date(now.getTime() + 2 * 60_000).toISOString()}::timestamptz,
			    last_started_at = ${now.toISOString()}::timestamptz,
			    attempts = s.attempts + 1
			FROM candidates c, mail_accounts a
			WHERE s.account_id = c.account_id AND a.id = s.account_id
			RETURNING s.*, a.workspace_id, a.owner_user_id
		`),
	);
	return rows as unknown as ClaimedState[];
}

export async function scanMailSync(now = new Date()): Promise<number> {
	const jobs = await claimSyncJobs(now);
	let completed = 0;
	for (const state of jobs) {
		try {
			if (state.sync_mode === "full") await fullSyncPage(state);
			else await partialSyncPage(state);
			completed += 1;
		} catch (error) {
			const safe = error instanceof MailSyncError
				? error
				: new MailSyncError("mail_contract_rejected", false);
			let sourceCode: string | null = null;
			let source: unknown = error;
			for (let depth = 0; depth < 4 && typeof source === "object" && source !== null; depth += 1) {
				if ("code" in source && typeof source.code === "string" && /^[A-Z0-9]{5}$/.test(source.code)) {
					sourceCode = source.code;
					break;
				}
				source = "cause" in source ? source.cause : null;
			}
			const logFailure = safe.code === "mail_history_expired" ? console.warn : console.error;
			logFailure(
				JSON.stringify({
					level: safe.code === "mail_history_expired" ? "warn" : "error",
					event: safe.code === "mail_history_expired" ? "mail_sync_recovery" : "mail_sync_job_failed",
					accountId: state.account_id,
					errorCode: safe.code,
					stage: safe.stage,
					retryable: safe.retryable,
					sourceCode,
				}),
			);
			await failClaim(state, safe);
		}
	}
	return completed;
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startMailSyncWorker(intervalMs = 10_000): void {
	if (timer || !mailGoogleEnabled) return;
	timer = setInterval(() => {
		scanMailSync().catch((error) =>
			console.error(
				JSON.stringify({
					level: "error",
					event: "mail_sync_scan_failed",
					name: error instanceof Error ? error.name : "UnknownError",
				}),
			),
		);
	}, intervalMs);
	console.log(`[mail-sync] worker běží (interval ${intervalMs / 1000}s)`);
}

async function ownerAccount(accountId: string, ownerUserId: string) {
	return (
		await getDb()
			.select({ id: mailAccounts.id, status: mailAccounts.status })
			.from(mailAccounts)
			.where(and(eq(mailAccounts.id, accountId), eq(mailAccounts.ownerUserId, ownerUserId)))
			.limit(1)
	)[0];
}

mailSyncRoutes.post("/api/mail/accounts/:accountId/sync", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const accountId = z.string().uuid().safeParse(c.req.param("accountId"));
	if (!accountId.success) return c.json({ error: "invalid_account_id" }, 422);
	const account = await ownerAccount(accountId.data, session.user.id);
	if (!account) return c.json({ error: "mail_account_not_found" }, 404);
	if (account.status !== "connected") return c.json({ error: "mail_account_inactive" }, 409);
	await getDb()
		.insert(mailSyncStates)
		.values({ accountId: account.id, status: "pending", syncMode: "full", requestedAt: new Date() })
		.onConflictDoUpdate({
			target: mailSyncStates.accountId,
			set: {
				status: sql`CASE WHEN ${mailSyncStates.status} = 'running' THEN 'running' ELSE 'pending' END`,
				requestedAt: new Date(),
				nextAttemptAt: null,
				lastErrorCode: null,
			},
		});
	return c.json({ accepted: true }, 202);
});

mailSyncRoutes.get("/api/mail/accounts/:accountId/sync", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const accountId = z.string().uuid().safeParse(c.req.param("accountId"));
	if (!accountId.success) return c.json({ error: "invalid_account_id" }, 422);
	const account = await ownerAccount(accountId.data, session.user.id);
	if (!account) return c.json({ error: "mail_account_not_found" }, 404);
	const [stateRows, countRows] = await Promise.all([
		getDb()
			.select({
				status: mailSyncStates.status,
				mode: mailSyncStates.syncMode,
				lastSuccessAt: mailSyncStates.lastSuccessAt,
				lastErrorCode: mailSyncStates.lastErrorCode,
				version: mailSyncStates.version,
			})
			.from(mailSyncStates)
			.where(eq(mailSyncStates.accountId, account.id))
			.limit(1),
		getDb()
			.select({
				total: sql<number>`count(*)::int`,
				unread: sql<number>`count(*) filter (where ${mailMessages.labelIds} ? 'UNREAD')::int`,
				inbox: sql<number>`count(*) filter (where ${mailMessages.labelIds} ? 'INBOX')::int`,
			})
			.from(mailMessages)
			.where(eq(mailMessages.accountId, account.id)),
	]);
	const state = stateRows[0];
	const counts = countRows[0] ?? { total: 0, unread: 0, inbox: 0 };
	return c.json({
		sync: state
			? { ...state, lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null }
			: null,
		counts,
	});
});

function decodeCursor(value: string | undefined): { at: string; id: string } | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
		const result = z.object({ at: z.string().datetime({ offset: true }), id: z.string().uuid() }).safeParse(parsed);
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

mailSyncRoutes.get("/api/mail/accounts/:accountId/messages", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const accountId = z.string().uuid().safeParse(c.req.param("accountId"));
	const limit = z.coerce.number().int().min(1).max(50).safeParse(c.req.query("limit") ?? "25");
	if (!accountId.success || !limit.success) return c.json({ error: "invalid_query" }, 422);
	const rawCursor = c.req.query("cursor");
	const cursor = decodeCursor(rawCursor);
	if (rawCursor && !cursor) return c.json({ error: "invalid_cursor" }, 422);
	const account = await ownerAccount(accountId.data, session.user.id);
	if (!account) return c.json({ error: "mail_account_not_found" }, 404);
	const rows = await getDb()
		.select()
		.from(mailMessages)
		.where(
			and(
				eq(mailMessages.accountId, account.id),
				cursor
					? sql`(${mailMessages.internalDate}, ${mailMessages.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
					: undefined,
			),
		)
		.orderBy(desc(mailMessages.internalDate), desc(mailMessages.id))
		.limit(limit.data + 1);
	const hasMore = rows.length > limit.data;
	const page = rows.slice(0, limit.data);
	const messages = page.map((row) => {
		const content = storedContentSchema.parse(
			decryptMailContent(
				{ accountId: account.id, provider: "google", providerMessageId: row.providerMessageId },
				envelopeFrom(row),
			),
		);
		return {
			id: row.id,
			providerMessageId: row.providerMessageId,
			threadId: row.providerThreadId,
			historyId: row.historyId,
			internalDate: row.internalDate.toISOString(),
			labelIds: row.labelIds,
			sizeEstimate: row.sizeEstimate,
			contentTruncated: row.contentTruncated,
			subject: content.subject,
			from: content.from,
			to: content.to,
			cc: content.cc,
			replyTo: content.replyTo,
			dateHeader: content.dateHeader,
			snippet: content.snippet,
			hasText: content.textBody.length > 0,
			hasHtml: content.htmlBody.length > 0,
			attachmentCount: content.attachments.length,
		};
	});
	const last = page.at(-1);
	return c.json({
		messages,
		nextCursor:
			hasMore && last
				? Buffer.from(JSON.stringify({ at: last.internalDate.toISOString(), id: last.id })).toString("base64url")
				: null,
	});
});

mailSyncRoutes.get("/api/mail/accounts/:accountId/messages/:messageId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const ids = z
		.object({ accountId: z.string().uuid(), messageId: z.string().uuid() })
		.safeParse(c.req.param());
	if (!ids.success) return c.json({ error: "invalid_message_id" }, 422);
	const account = await ownerAccount(ids.data.accountId, session.user.id);
	if (!account) return c.json({ error: "mail_account_not_found" }, 404);
	const row = (
		await getDb()
			.select()
			.from(mailMessages)
			.where(
				and(
					eq(mailMessages.id, ids.data.messageId),
					eq(mailMessages.accountId, account.id),
				),
			)
			.limit(1)
	)[0];
	if (!row) return c.json({ error: "mail_message_not_found" }, 404);
	const content = storedContentSchema.parse(
		decryptMailContent(
			{ accountId: account.id, provider: "google", providerMessageId: row.providerMessageId },
			envelopeFrom(row),
		),
	);
	const { htmlBody, authenticationResults, returnPath, messageIdHeader, ...safeContent } = content;
	return c.json({
		message: {
			id: row.id,
			providerMessageId: row.providerMessageId,
			threadId: row.providerThreadId,
			historyId: row.historyId,
			internalDate: row.internalDate.toISOString(),
			labelIds: row.labelIds,
			sizeEstimate: row.sizeEstimate,
			contentTruncated: row.contentTruncated,
			...safeContent,
			hasHtml: htmlBody.length > 0,
			security: assessSenderIdentity({
				from: content.from,
				replyTo: content.replyTo,
				returnPath,
				authenticationResults,
				messageIdHeader,
			}),
		},
	});
});
