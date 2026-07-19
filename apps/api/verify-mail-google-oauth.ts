/** F5 Mail M1: end-to-end Google OAuth/PKCE, vault, ACL, revoke and reconnect proof. */
import "./src/env";
import {
	and,
	auditEvents,
	eq,
	getDb,
	mailAccountCredentials,
	mailAccounts,
	mailCommandReceipts,
	mailOauthSessions,
	memberships,
	sql,
	users,
	workspaces,
} from "@watson/db";
import { isDeepStrictEqual } from "node:util";

const API = process.env.MAIL_API ?? "http://127.0.0.1:8790";
const STUB = process.env.MAIL_GOOGLE_API_BASE_URL ?? "http://127.0.0.1:8793";
const db = getDb();
let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed += 1;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

function sqlState(error: unknown) {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
		const candidate = current as { code?: unknown; cause?: unknown };
		if (typeof candidate.code === "string") return candidate.code;
		current = candidate.cause;
	}
	return null;
}

async function login(email: string) {
	const requested = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
		body: JSON.stringify({ email, callbackURL: "http://localhost:5173/" }),
	});
	if (!requested.ok) throw new Error(`magic link ${email}: ${requested.status}`);
	const rows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as unknown as Array<{ identifier: string }>;
	const verified = await fetch(
		`${API}/api/auth/magic-link/verify?token=${rows[0]?.identifier}&callbackURL=http://localhost:5173/`,
		{ redirect: "manual" },
	);
	const raw = verified.headers.getSetCookie?.().join("; ") ?? verified.headers.get("set-cookie") ?? "";
	const cookie = raw
		.split(/,(?=\s*\w+=)/)
		.map((part) => part.split(";")[0]?.trim())
		.filter(Boolean)
		.join("; ");
	if (!cookie) throw new Error(`login ${email}: no cookie`);
	return cookie;
}

async function request(cookie: string | null, path: string, method = "GET", body?: unknown) {
	const response = await fetch(`${API}${path}`, {
		method,
		redirect: "manual",
		headers: {
			Origin: "http://localhost:5173",
			...(cookie ? { Cookie: cookie } : {}),
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let parsed: Record<string, unknown> = {};
	try {
		parsed = JSON.parse(text || "{}") as Record<string, unknown>;
	} catch {
		// Redirecty nemají JSON body.
	}
	return { status: response.status, text, body: parsed, location: response.headers.get("location") };
}

async function makeIdentity(slug: string, stamp: string) {
	const [user] = await db
		.insert(users)
		.values({
			name: `Mail OAuth ${slug}`,
			email: `mail-google-${slug}-${stamp}@watson.test`,
			emailVerified: true,
		})
		.returning({ id: users.id, email: users.email });
	if (!user) throw new Error("mail OAuth user missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Mail OAuth ${slug}`, ownerId: user.id, isPersonal: true })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("mail OAuth workspace missing");
	await db.insert(memberships).values({ workspaceId: workspace.id, userId: user.id, role: "admin" });
	return { ...user, workspaceId: workspace.id };
}

async function start(cookie: string) {
	const response = await request(cookie, "/api/mail/oauth/google/start", "POST");
	const authorizationUrl = response.body.authorizationUrl;
	if (response.status !== 200 || typeof authorizationUrl !== "string") {
		throw new Error(`OAuth start failed: ${response.status} ${response.text}`);
	}
	return { response, authorizationUrl, parsed: new URL(authorizationUrl) };
}

async function providerAuthorize(authorizationUrl: string) {
	const response = await fetch(authorizationUrl, { redirect: "manual" });
	const location = response.headers.get("location");
	if (response.status !== 302 || !location) throw new Error(`provider authorization: ${response.status}`);
	return location;
}

async function stats() {
	const response = await fetch(`${STUB}/test/stats`);
	return (await response.json()) as { tokenExchanges: number; revocations: number; activeTokens: number };
}

async function main() {
	if (!STUB.startsWith("http://127.0.0.1:")) throw new Error("mail verifier requires local provider stub");
	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const owner = await makeIdentity("owner", stamp);
	const stranger = await makeIdentity("stranger", stamp);
	const malformed = await makeIdentity("malformed", stamp);
	const denied = await makeIdentity("denied", stamp);
	try {
		const ownerCookie = await login(owner.email);
		const strangerCookie = await login(stranger.email);
		const malformedCookie = await login(malformed.email);
		const deniedCookie = await login(denied.email);

		let response = await request(null, "/api/mail/accounts");
		check("mailbox registry je bez session fail-closed", response.status === 401, response);

		const flow = await start(ownerCookie);
		check(
			"OAuth start používá lokální provider, minimální scope a PKCE S256",
			flow.parsed.origin === new URL(STUB).origin &&
				flow.parsed.searchParams.get("scope") === "https://www.googleapis.com/auth/gmail.modify" &&
				flow.parsed.searchParams.get("code_challenge_method") === "S256" &&
				(flow.parsed.searchParams.get("code_challenge")?.length ?? 0) >= 43 &&
				flow.parsed.searchParams.get("access_type") === "offline",
			flow.authorizationUrl,
		);
		check(
			"browser nedostane client secret ani PKCE verifier",
			!flow.response.text.includes(process.env.MAIL_GOOGLE_CLIENT_SECRET ?? "mail-google-ci-secret") &&
				!flow.response.text.includes("code_verifier") &&
				!flow.response.text.includes(owner.workspaceId),
			flow.response.text,
		);

		const callback = await providerAuthorize(flow.authorizationUrl);
		response = await request(strangerCookie, callback.replace(API, ""));
		check(
			"OAuth state je svázaný s uživatelem",
			response.status === 302 && response.location?.includes("code=mail_oauth_state_invalid") === true,
			response,
		);
		response = await request(ownerCookie, callback.replace(API, ""));
		check(
			"správný callback připojí mailbox a vrátí jen bezpečný redirect",
			response.status === 302 && response.location?.includes("mailConnection=success") === true,
			response,
		);
		response = await request(ownerCookie, callback.replace(API, ""));
		check(
			"stejný state nelze přehrát",
			response.status === 302 && response.location?.includes("mail_oauth_state_invalid") === true,
			response,
		);

		response = await request(ownerCookie, "/api/mail/accounts");
		const accounts = response.body.accounts as Array<Record<string, unknown>> | undefined;
		const account = accounts?.[0];
		check(
			"osobní registry vrátí právě skutečně připojený Google účet",
			response.status === 200 &&
				accounts?.length === 1 &&
				account?.emailAddress === owner.email &&
				account?.status === "connected" &&
				account?.version === 1,
			response,
		);
		check(
			"public snapshot neobsahuje token, provider hash ani workspace",
			!["access-", "refresh-", "ciphertext", "providerAccountHash", owner.workspaceId].some((needle) =>
				response.text.includes(needle),
			),
			response.text,
		);
		const accountId = String(account?.id ?? "");
		const [credential] = await db
			.select()
			.from(mailAccountCredentials)
			.where(eq(mailAccountCredentials.accountId, accountId));
		check(
			"credential je v DB pouze autentizovaný envelope",
			Boolean(credential) &&
				credential?.algorithm === "aes-256-gcm-v1" &&
				!JSON.stringify(credential).includes("access-") &&
				!JSON.stringify(credential).includes("refresh-"),
			credential && { algorithm: credential.algorithm, keyId: credential.keyId },
		);
		const oauthRows = await db
			.select({ id: mailOauthSessions.id })
			.from(mailOauthSessions)
			.where(eq(mailOauthSessions.ownerUserId, owner.id));
		check("spotřebovaný OAuth verifier je fyzicky odstraněný", oauthRows.length === 0);

		response = await request(strangerCookie, "/api/mail/accounts");
		check(
			"jiný uživatel nevidí cizí osobní schránku",
			response.status === 200 && (response.body.accounts as unknown[])?.length === 0,
			response,
		);
		response = await request(strangerCookie, `/api/mail/accounts/${accountId}/revoke`, "POST", {
			operationId: crypto.randomUUID(),
			expectedVersion: 1,
		});
		check("cizí uživatel mailbox nerevokuje a existence se neprozradí", response.status === 404, response);

		const beforeStale = await stats();
		response = await request(ownerCookie, `/api/mail/accounts/${accountId}/revoke`, "POST", {
			operationId: crypto.randomUUID(),
			expectedVersion: 99,
		});
		const afterStale = await stats();
		check(
			"stale CAS skončí před provider revokací",
			response.status === 409 && afterStale.revocations === beforeStale.revocations,
			{ response, beforeStale, afterStale },
		);

		const operationId = crypto.randomUUID();
		response = await request(ownerCookie, `/api/mail/accounts/${accountId}/revoke`, "POST", {
			operationId,
			expectedVersion: 1,
		});
		const revokeBody = response.body;
		const afterRevoke = await stats();
		check(
			"revoke potvrdí provider a vrátí redigovaný revoked snapshot",
			response.status === 200 &&
				(revokeBody.account as Record<string, unknown> | undefined)?.status === "revoked" &&
				afterRevoke.revocations === beforeStale.revocations + 1,
			{ response, afterRevoke },
		);
		const credentialsAfterRevoke = await db
			.select({ id: mailAccountCredentials.accountId })
			.from(mailAccountCredentials)
			.where(eq(mailAccountCredentials.accountId, accountId));
		check("provider revoke fyzicky smaže lokální credential", credentialsAfterRevoke.length === 0);

		response = await request(ownerCookie, `/api/mail/accounts/${accountId}/revoke`, "POST", {
			operationId,
			expectedVersion: 1,
		});
		const afterReplay = await stats();
		check(
			"přesný revoke retry vrátí receipt bez druhé provider revokace",
			response.status === 200 &&
				isDeepStrictEqual(response.body, revokeBody) &&
				afterReplay.revocations === afterRevoke.revocations,
			{ response, afterReplay },
		);
		response = await request(ownerCookie, `/api/mail/accounts/${accountId}/revoke`, "POST", {
			operationId,
			expectedVersion: 2,
		});
		check("operation ID nelze znovu použít pro jiný command", response.status === 409, response);

		const reconnect = await start(ownerCookie);
		const reconnectCallback = await providerAuthorize(reconnect.authorizationUrl);
		response = await request(ownerCookie, reconnectCallback.replace(API, ""));
		check("OAuth reconnect po revoke uspěje", response.location?.includes("mailConnection=success") === true);
		response = await request(ownerCookie, "/api/mail/accounts");
		const reconnected = (response.body.accounts as Array<Record<string, unknown>> | undefined)?.[0];
		check(
			"reconnect reaktivuje stejné ID místo duplicitního účtu",
			(response.body.accounts as unknown[])?.length === 1 &&
				reconnected?.id === accountId &&
				reconnected?.status === "connected" &&
				reconnected?.version === 3,
			response,
		);

		const malformedFlow = await start(malformedCookie);
		const malformedCallback = await providerAuthorize(malformedFlow.authorizationUrl);
		response = await request(malformedCookie, malformedCallback.replace(API, ""));
		check(
			"malformed token ACK není vydán za připojený mailbox a nic neunikne",
			response.status === 302 &&
				response.location?.includes("code=mail_contract_rejected") === true &&
				!String(response.location).includes("upstream_secret") &&
				(await db.select().from(mailAccounts).where(eq(mailAccounts.ownerUserId, malformed.id))).length === 0,
			response,
		);
		const malformedAudit = await db
			.select({ action: auditEvents.action, diff: auditEvents.diff })
			.from(auditEvents)
			.where(
				and(
					eq(auditEvents.workspaceId, malformed.workspaceId),
					eq(auditEvents.entity, "mail_oauth_session"),
				),
			);
		check(
			"provider failure má redigovaný audit bez upstream payloadu",
			malformedAudit.some(
				(row) =>
					row.action === "connection_failed" &&
					(row.diff as { code?: string } | null)?.code === "mail_contract_rejected",
			) && !JSON.stringify(malformedAudit).includes("upstream_secret"),
			malformedAudit,
		);

		const beforeDenied = await stats();
		const deniedFlow = await start(deniedCookie);
		const deniedCallback = await providerAuthorize(deniedFlow.authorizationUrl);
		response = await request(deniedCookie, deniedCallback.replace(API, ""));
		const afterDenied = await stats();
		check(
			"zamítnutý consent nevymění kód ani nevytvoří účet",
			response.location?.includes("code=mail_oauth_denied") === true &&
				afterDenied.tokenExchanges === beforeDenied.tokenExchanges &&
				(await db.select().from(mailAccounts).where(eq(mailAccounts.ownerUserId, denied.id))).length === 0,
			{ response, beforeDenied, afterDenied },
		);

		let forgedReceipt = false;
		try {
			await db.insert(mailCommandReceipts).values({
				accountId,
				actorUserId: stranger.id,
				operationId: crypto.randomUUID(),
				requestHash: "a".repeat(64),
				action: "revoke",
				response: { ok: true },
			});
		} catch (error) {
			forgedReceipt = sqlState(error) === "23514";
		}
		check("DB nedovolí připsat lifecycle receipt cizímu aktérovi", forgedReceipt);

		const audit = await db
			.select({ action: auditEvents.action, diff: auditEvents.diff })
			.from(auditEvents)
			.where(and(eq(auditEvents.entity, "mail_account"), eq(auditEvents.entityId, accountId)));
		const auditText = JSON.stringify(audit);
		check(
			"connect, revoke i reconnect mají audit bez tokenů a e-mailového obsahu",
			["connected", "revoked", "reconnected"].every((action) =>
				audit.some((row) => row.action === action),
			) &&
				!auditText.includes("access-") &&
				!auditText.includes("refresh-"),
			audit,
		);
	} finally {
		for (const identity of [owner, stranger, malformed, denied]) {
			await db.delete(workspaces).where(eq(workspaces.id, identity.workspaceId));
			await db.delete(users).where(eq(users.id, identity.id));
		}
	}

	if (failed) throw new Error(`mail Google OAuth failed: ${failed}`);
	console.log("\nMail Google OAuth: všechny kontroly prošly");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
