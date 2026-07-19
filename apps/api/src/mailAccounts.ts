/**
 * F5 Mail M1 — osobní Gmail OAuth connection lifecycle.
 *
 * Tento modul zatím nepřenáší zprávy. Autoritativně připojuje/revokuje mailbox,
 * drží provider scopes a ukládá tokeny výhradně přes mailVault. Demo banner Mailu
 * proto zůstává až do následného inbound/outbound E2E důkazu.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
	and,
	auditEvents,
	eq,
	getDb,
	isNull,
	mailAccountCredentials,
	mailAccounts,
	mailCommandReceipts,
	mailMessages,
	mailOauthSessions,
	mailOutboundMessages,
	mailSyncStates,
	sql,
	workspaces,
} from "@watson/db";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { auth } from "./auth";
import { env, mailGoogleEnabled } from "./env";
import {
	decryptMailSecret,
	encryptMailSecret,
	type MailVaultContext,
	type MailVaultEnvelope,
} from "./mailVault";

export const mailAccountRoutes = new Hono<{ Variables: { requestId: string } }>();
type MailContext = Context<{ Variables: { requestId: string } }>;

const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const GOOGLE_CAPABILITIES = ["read", "send", "modify", "labels"] as const;
const OAUTH_TTL_MS = 10 * 60_000;
const PROVIDER_TIMEOUT_MS = 10_000;

const googleTokenSchema = z
	.object({
		access_token: z.string().min(16).max(8192),
		refresh_token: z.string().min(16).max(8192),
		expires_in: z.number().int().positive().max(86_400),
		scope: z.string().min(1).max(4096),
		token_type: z.string().min(1).max(32),
	})
	.passthrough();
const googleProfileSchema = z
	.object({
		emailAddress: z.string().trim().toLowerCase().email().max(320),
		historyId: z.string().min(1).max(64),
	})
	.passthrough();
const oauthSecretSchema = z.object({ purpose: z.literal("oauth_pkce"), codeVerifier: z.string().min(43).max(128) });
const googleCredentialSchema = z.object({
	purpose: z.literal("google_mailbox"),
	accessToken: z.string().min(16).max(8192),
	refreshToken: z.string().min(16).max(8192),
	expiresAt: z.string().datetime({ offset: true }),
	tokenType: z.string().min(1).max(32),
	grantedScopes: z.array(z.string().min(1).max(512)).min(1).max(32),
});
const callbackSchema = z
	.object({
		state: z.string().min(32).max(256),
		code: z.string().min(1).max(4096).optional(),
		error: z.string().min(1).max(128).optional(),
	})
	.refine((value) => Boolean(value.code) !== Boolean(value.error), "invalid_oauth_callback");
const lifecycleSchema = z
	.object({
		operationId: z.string().uuid(),
		expectedVersion: z.number().int().positive(),
	})
	.strict();

class MailAccountError extends Error {
	constructor(
		readonly code: string,
		readonly status: 400 | 401 | 404 | 409 | 422 | 502 | 503 | 504,
	) {
		super(code);
	}
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function base64UrlSha256(value: string): string {
	return createHash("sha256").update(value).digest("base64url");
}

function safeWebRedirect(result: "success" | "error", code?: string): string {
	const target = new URL("/mail", env.webOrigin);
	target.searchParams.set("mailConnection", result);
	if (code) target.searchParams.set("code", code);
	return target.toString();
}

function publicMailAccount(row: typeof mailAccounts.$inferSelect) {
	return {
		id: row.id,
		provider: row.provider,
		emailAddress: row.emailAddress,
		displayName: row.displayName,
		status: row.status,
		grantedScopes: row.grantedScopes,
		capabilities: row.capabilities,
		lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
		lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
		lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
		lastErrorCode: row.lastErrorCode,
		revokedAt: row.revokedAt?.toISOString() ?? null,
		version: row.version,
	};
}

async function personalWorkspaceId(userId: string): Promise<string> {
	const row = (
		await getDb()
			.select({ id: workspaces.id })
			.from(workspaces)
			.where(and(eq(workspaces.ownerId, userId), eq(workspaces.isPersonal, true)))
			.limit(1)
	)[0];
	if (!row) throw new MailAccountError("personal_workspace_missing", 409);
	return row.id;
}

async function providerFetch(url: string, init: RequestInit): Promise<Response> {
	try {
		return await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
	} catch (error) {
		if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
			throw new MailAccountError("mail_provider_timeout", 504);
		}
		throw new MailAccountError("mail_provider_unavailable", 502);
	}
}

async function exchangeGoogleCode(code: string, codeVerifier: string) {
	const response = await providerFetch(env.mailGoogle.tokenUrl, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env.mailGoogle.clientId ?? "",
			client_secret: env.mailGoogle.clientSecret ?? "",
			code,
			code_verifier: codeVerifier,
			grant_type: "authorization_code",
			redirect_uri: env.mailGoogle.redirectUri,
		}),
	});
	if (!response.ok) {
		throw new MailAccountError(response.status === 429 ? "mail_rate_limited" : "mail_oauth_rejected", 502);
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new MailAccountError("mail_contract_rejected", 502);
	}
	const parsed = googleTokenSchema.safeParse(payload);
	if (!parsed.success) throw new MailAccountError("mail_contract_rejected", 502);
	const grantedScopes = [...new Set(parsed.data.scope.split(/\s+/).filter(Boolean))].sort();
	if (!grantedScopes.includes(GMAIL_MODIFY_SCOPE)) {
		throw new MailAccountError("mail_scope_missing", 422);
	}
	return { token: parsed.data, grantedScopes };
}

async function readGoogleProfile(accessToken: string) {
	const response = await providerFetch(`${env.mailGoogle.apiBaseUrl}/gmail/v1/users/me/profile`, {
		headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
	});
	if (!response.ok) throw new MailAccountError("mail_identity_rejected", 502);
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new MailAccountError("mail_contract_rejected", 502);
	}
	const parsed = googleProfileSchema.safeParse(payload);
	if (!parsed.success) throw new MailAccountError("mail_contract_rejected", 502);
	return parsed.data;
}

async function revokeGoogleToken(token: string) {
	const response = await providerFetch(env.mailGoogle.revokeUrl, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ token }),
	});
	if (!response.ok) {
		throw new MailAccountError(response.status === 429 ? "mail_rate_limited" : "mail_revoke_failed", 502);
	}
}

async function storeGoogleAccount(
	c: MailContext,
	ownerUserId: string,
	workspaceId: string,
	profile: z.infer<typeof googleProfileSchema>,
	token: z.infer<typeof googleTokenSchema>,
	grantedScopes: string[],
) {
	const providerAccountHash = sha256(profile.emailAddress);
	return getDb().transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mail:google:${ownerUserId}:${providerAccountHash}`}, 0))`,
		);
		const existing = (
			await tx
				.select()
				.from(mailAccounts)
				.where(
					and(
						eq(mailAccounts.ownerUserId, ownerUserId),
						eq(mailAccounts.provider, "google"),
						eq(mailAccounts.providerAccountHash, providerAccountHash),
					),
				)
				.limit(1)
		)[0];
		const accountId = existing?.id ?? randomUUID();
		const context: MailVaultContext = {
			accountId,
			ownerUserId,
			provider: "google",
			secretKind: "google_oauth",
		};
		const credential = {
			purpose: "google_mailbox",
			accessToken: token.access_token,
			refreshToken: token.refresh_token,
			expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
			tokenType: token.token_type,
			grantedScopes,
		};
		const envelope = encryptMailSecret(context, credential);
		let row: typeof mailAccounts.$inferSelect | undefined;
		if (existing) {
			[row] = await tx
				.update(mailAccounts)
				.set({
					workspaceId,
					emailAddress: profile.emailAddress,
					status: "connected",
					grantedScopes,
					capabilities: [...GOOGLE_CAPABILITIES],
					lastSuccessAt: new Date(),
					lastErrorCode: null,
					revokedAt: null,
					version: sql`${mailAccounts.version} + 1`,
				})
				.where(eq(mailAccounts.id, accountId))
				.returning();
		} else {
			[row] = await tx
				.insert(mailAccounts)
				.values({
					id: accountId,
					workspaceId,
					ownerUserId,
					provider: "google",
					emailAddress: profile.emailAddress,
					providerAccountHash,
					status: "connected",
					grantedScopes,
					capabilities: [...GOOGLE_CAPABILITIES],
					lastSuccessAt: new Date(),
				})
				.returning();
		}
		if (!row) throw new MailAccountError("mail_account_write_failed", 503);
		await tx
			.insert(mailAccountCredentials)
			.values({ accountId, secretKind: "google_oauth", ...envelope })
			.onConflictDoUpdate({
				target: mailAccountCredentials.accountId,
				set: {
					secretKind: "google_oauth",
					...envelope,
					credentialVersion: sql`${mailAccountCredentials.credentialVersion} + 1`,
				},
			});
		await tx
			.insert(mailSyncStates)
			.values({ accountId, status: "pending", syncMode: "full", requestedAt: new Date() })
			.onConflictDoUpdate({
				target: mailSyncStates.accountId,
				set: {
					status: "pending",
					requestedAt: new Date(),
					nextAttemptAt: null,
					leaseToken: null,
					leaseUntil: null,
					attempts: 0,
					lastErrorCode: null,
					version: sql`${mailSyncStates.version} + 1`,
				},
			});
		await tx.insert(auditEvents).values({
			workspaceId,
			actorType: "user",
			actorUserId: ownerUserId,
			entity: "mail_account",
			entityId: accountId,
			action: existing ? "reconnected" : "connected",
			diff: {
				provider: "google",
				status: "connected",
				grantedScopes,
				credentialVersion: existing ? "rotated" : "created",
			},
			requestId: c.get("requestId") ?? null,
		});
		return row;
	});
}

function envelopeFrom(row: {
	algorithm: string;
	keyId: string;
	nonce: string;
	authTag: string;
	ciphertext: string;
}): MailVaultEnvelope {
	if (row.algorithm !== "aes-256-gcm-v1") throw new MailAccountError("mail_vault_algorithm_unsupported", 503);
	return { algorithm: "aes-256-gcm-v1", keyId: row.keyId, nonce: row.nonce, authTag: row.authTag, ciphertext: row.ciphertext };
}

mailAccountRoutes.get("/api/mail/accounts", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const rows = await getDb()
		.select()
		.from(mailAccounts)
		.where(eq(mailAccounts.ownerUserId, session.user.id));
	return c.json({ accounts: rows.map(publicMailAccount), googleAvailable: mailGoogleEnabled });
});

mailAccountRoutes.post("/api/mail/oauth/google/start", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	if (!mailGoogleEnabled) return c.json({ error: "mail_google_not_configured" }, 503);
	const workspaceId = await personalWorkspaceId(session.user.id);
	const flowId = randomUUID();
	const state = randomBytes(32).toString("base64url");
	const codeVerifier = randomBytes(64).toString("base64url");
	const context: MailVaultContext = {
		accountId: flowId,
		ownerUserId: session.user.id,
		provider: "google",
		secretKind: "google_oauth",
	};
	const envelope = encryptMailSecret(context, { purpose: "oauth_pkce", codeVerifier });
	const expiresAt = new Date(Date.now() + OAUTH_TTL_MS);
	await getDb().transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mail:oauth-start:${session.user.id}`}, 0))`,
		);
		await tx
			.delete(mailOauthSessions)
			.where(eq(mailOauthSessions.ownerUserId, session.user.id));
		await tx.insert(mailOauthSessions).values({
			id: flowId,
			workspaceId,
			ownerUserId: session.user.id,
			provider: "google",
			stateHash: sha256(state),
			...envelope,
			expiresAt,
		});
	});
	const authorization = new URL(env.mailGoogle.authUrl);
	authorization.search = new URLSearchParams({
		access_type: "offline",
		client_id: env.mailGoogle.clientId ?? "",
		code_challenge: base64UrlSha256(codeVerifier),
		code_challenge_method: "S256",
		include_granted_scopes: "true",
		login_hint: session.user.email,
		prompt: "consent select_account",
		redirect_uri: env.mailGoogle.redirectUri,
		response_type: "code",
		scope: GMAIL_MODIFY_SCOPE,
		state,
	}).toString();
	c.header("Cache-Control", "no-store");
	return c.json({ authorizationUrl: authorization.toString(), expiresAt: expiresAt.toISOString() });
});

mailAccountRoutes.get("/api/mail/oauth/google/callback", async (c) => {
	c.header("Cache-Control", "no-store");
	c.header("Referrer-Policy", "no-referrer");
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.redirect(safeWebRedirect("error", "mail_auth_session_missing"));
	const parsed = callbackSchema.safeParse(c.req.query());
	if (!parsed.success) return c.redirect(safeWebRedirect("error", "mail_oauth_callback_invalid"));
	const claimed = (
		await getDb()
			.update(mailOauthSessions)
			.set({ consumedAt: new Date() })
			.where(
				and(
					eq(mailOauthSessions.ownerUserId, session.user.id),
					eq(mailOauthSessions.stateHash, sha256(parsed.data.state)),
					isNull(mailOauthSessions.consumedAt),
					sql`${mailOauthSessions.expiresAt} > now()`,
				),
			)
			.returning()
	)[0];
	if (!claimed) return c.redirect(safeWebRedirect("error", "mail_oauth_state_invalid"));
	if (parsed.data.error) {
		await getDb().insert(auditEvents).values({
			workspaceId: claimed.workspaceId,
			actorType: "user",
			actorUserId: session.user.id,
			entity: "mail_oauth_session",
			entityId: claimed.id,
			action: "consent_denied",
			diff: { provider: "google", result: "denied" },
			requestId: c.get("requestId") ?? null,
		});
		await getDb().delete(mailOauthSessions).where(eq(mailOauthSessions.id, claimed.id));
		return c.redirect(safeWebRedirect("error", "mail_oauth_denied"));
	}
	let issuedRefreshToken: string | null = null;
	try {
		const context: MailVaultContext = {
			accountId: claimed.id,
			ownerUserId: session.user.id,
			provider: "google",
			secretKind: "google_oauth",
		};
		const secret = oauthSecretSchema.parse(
			decryptMailSecret(context, envelopeFrom(claimed)),
		);
		const exchanged = await exchangeGoogleCode(parsed.data.code ?? "", secret.codeVerifier);
		issuedRefreshToken = exchanged.token.refresh_token;
		const profile = await readGoogleProfile(exchanged.token.access_token);
		await storeGoogleAccount(
			c,
			session.user.id,
			claimed.workspaceId,
			profile,
			exchanged.token,
			exchanged.grantedScopes,
		);
		return c.redirect(safeWebRedirect("success"));
	} catch (error) {
		if (issuedRefreshToken) {
			try {
				await revokeGoogleToken(issuedRefreshToken);
			} catch {
				// Původní bezpečný callback error má přednost; orphan revoke lze zopakovat
				// z provider incident logu, nikdy se ale nesmí propsat credential do DB.
			}
		}
		const code = error instanceof MailAccountError ? error.code : "mail_connection_failed";
		await getDb().insert(auditEvents).values({
			workspaceId: claimed.workspaceId,
			actorType: "user",
			actorUserId: session.user.id,
			entity: "mail_oauth_session",
			entityId: claimed.id,
			action: "connection_failed",
			diff: { provider: "google", code },
			requestId: c.get("requestId") ?? null,
		});
		return c.redirect(safeWebRedirect("error", code));
	} finally {
		await getDb().delete(mailOauthSessions).where(eq(mailOauthSessions.id, claimed.id));
	}
});

mailAccountRoutes.post("/api/mail/accounts/:accountId/revoke", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const body = lifecycleSchema.safeParse(await c.req.json().catch(() => null));
	if (!body.success) return c.json({ error: "invalid_body" }, 422);
	const accountId = z.string().uuid().safeParse(c.req.param("accountId"));
	if (!accountId.success) return c.json({ error: "invalid_account_id" }, 422);
	const requestHash = sha256(
		JSON.stringify({ action: "revoke", accountId: accountId.data, ...body.data }),
	);
	try {
		const response = await getDb().transaction(async (tx) => {
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
				if (replay.requestHash !== requestHash) throw new MailAccountError("operation_id_reused", 409);
				return replay.response;
			}
			const rows = (await tx.execute(sql`
				SELECT ma.*, mac.secret_kind, mac.algorithm, mac.key_id, mac.nonce,
				       mac.auth_tag, mac.ciphertext
				FROM mail_accounts ma
				LEFT JOIN mail_account_credentials mac ON mac.account_id = ma.id
				WHERE ma.id = ${accountId.data} AND ma.owner_user_id = ${session.user.id}
				FOR UPDATE OF ma
			`)) as unknown as Array<{
				id: string;
				workspace_id: string;
				owner_user_id: string;
				provider: "google" | "imap_smtp";
				status: string;
				version: number;
				secret_kind: "google_oauth" | "imap_smtp" | null;
				algorithm: string | null;
				key_id: string | null;
				nonce: string | null;
				auth_tag: string | null;
				ciphertext: string | null;
			}>;
			const account = rows[0];
			if (!account) throw new MailAccountError("mail_account_not_found", 404);
			if (account.version !== body.data.expectedVersion) throw new MailAccountError("stale_version", 409);
			if (account.status === "revoked") throw new MailAccountError("mail_account_already_revoked", 409);
			if (
				!account.secret_kind ||
				!account.algorithm ||
				!account.key_id ||
				!account.nonce ||
				!account.auth_tag ||
				!account.ciphertext
			) {
				throw new MailAccountError("mail_credentials_missing", 409);
			}
			if (account.provider === "google") {
				const credential = googleCredentialSchema.parse(
					decryptMailSecret(
						{
							accountId: account.id,
							ownerUserId: account.owner_user_id,
							provider: "google",
							secretKind: "google_oauth",
						},
						envelopeFrom({
							algorithm: account.algorithm,
							keyId: account.key_id,
							nonce: account.nonce,
							authTag: account.auth_tag,
							ciphertext: account.ciphertext,
						}),
					),
				);
				await revokeGoogleToken(credential.refreshToken);
			}
			// Neodeslaný obsah po revoke nesmí zůstat čekat na credential. Již
			// claimnutý send má nejednoznačný výsledek a proto se nikdy neretryuje.
			await tx
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
						eq(mailOutboundMessages.accountId, account.id),
						sql`${mailOutboundMessages.status} in ('queued', 'retry')`,
					),
				);
			await tx
				.update(mailOutboundMessages)
				.set({
					status: "uncertain",
					leaseToken: null,
					leaseUntil: null,
					lastErrorCode: "mail_delivery_uncertain",
					version: sql`${mailOutboundMessages.version} + 1`,
				})
				.where(
					and(
						eq(mailOutboundMessages.accountId, account.id),
						eq(mailOutboundMessages.status, "sending"),
					),
				);
			await tx.delete(mailMessages).where(eq(mailMessages.accountId, account.id));
			await tx.delete(mailSyncStates).where(eq(mailSyncStates.accountId, account.id));
			await tx.delete(mailAccountCredentials).where(eq(mailAccountCredentials.accountId, account.id));
			const [updated] = await tx
				.update(mailAccounts)
				.set({
					status: "revoked",
					revokedAt: new Date(),
					lastErrorCode: "mail_auth_revoked",
					version: sql`${mailAccounts.version} + 1`,
				})
				.where(eq(mailAccounts.id, account.id))
				.returning();
			if (!updated) throw new MailAccountError("mail_account_write_failed", 503);
			const publicResponse = { account: publicMailAccount(updated) };
			await tx.insert(mailCommandReceipts).values({
				accountId: account.id,
				actorUserId: session.user.id,
				operationId: body.data.operationId,
				requestHash,
				action: "revoke",
				response: publicResponse,
			});
			await tx.insert(auditEvents).values({
				workspaceId: account.workspace_id,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "mail_account",
				entityId: account.id,
				action: "revoked",
				diff: {
					provider: account.provider,
					status: "revoked",
					credential: "deleted",
					syncedContent: "deleted",
					operationId: body.data.operationId,
				},
				requestId: c.get("requestId") ?? null,
			});
			return publicResponse;
		});
		return c.json(response);
	} catch (error) {
		if (error instanceof MailAccountError) return c.json({ error: error.code }, error.status);
		if (error instanceof z.ZodError) return c.json({ error: "mail_credentials_invalid" }, 503);
		throw error;
	}
});
