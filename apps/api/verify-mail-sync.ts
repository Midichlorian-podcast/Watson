/** F5 Mail M1: full/history sync, encrypted content, ACL, recovery and revoke proof. */
import "./src/env";
import {
	accounts,
	and,
	auditEvents,
	eq,
	getDb,
	mailAccountCredentials,
	mailAccounts,
	mailMessages,
	mailSyncStates,
	memberships,
	users,
	workspaces,
} from "@watson/db";
import { hashPassword } from "better-auth/crypto";
import { scanMailSync } from "./src/mailSync";

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

async function provision(slug: string) {
	const userId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const email = `mail-sync-${slug}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	await db.transaction(async (tx) => {
		await tx.insert(users).values({ id: userId, name: `Mail Sync ${slug}`, email, emailVerified: true });
		await tx.insert(accounts).values({
			id: crypto.randomUUID(),
			userId,
			accountId: email,
			providerId: "credential",
			password: await hashPassword(password),
		});
		await tx.insert(workspaces).values({ id: workspaceId, name: `Mail Sync ${slug}`, ownerId: userId, isPersonal: true });
		await tx.insert(memberships).values({ workspaceId, userId, role: "admin" });
	});
	return { userId, workspaceId, email, password };
}

async function login(email: string, password: string) {
	const response = await fetch(`${API}/api/auth/sign-in/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
		body: JSON.stringify({ email, password }),
	});
	if (!response.ok) throw new Error(`mail sync login failed: ${response.status}`);
	return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
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
		// Redirect response.
	}
	return { status: response.status, body: parsed, text, location: response.headers.get("location") };
}

async function providerControl(email: string, action: string, extra: Record<string, unknown> = {}) {
	const response = await fetch(`${STUB}/test/mailbox`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, action, ...extra }),
	});
	if (!response.ok) throw new Error(`provider control ${action}: ${response.status}`);
	return (await response.json()) as Record<string, unknown>;
}

async function providerStats() {
	return (await (await fetch(`${STUB}/test/stats`)).json()) as {
		refreshes: number;
		messageGets: number;
		historyLists: number;
	};
}

async function connect(cookie: string) {
	const started = await request(cookie, "/api/mail/oauth/google/start", "POST");
	const authorizationUrl = String(started.body.authorizationUrl ?? "");
	const provider = await fetch(authorizationUrl, { redirect: "manual" });
	const callback = provider.headers.get("location");
	if (!callback) throw new Error("mail sync provider callback missing");
	const completed = await request(cookie, callback.replace(API, ""));
	if (!completed.location?.includes("mailConnection=success")) {
		throw new Error(`mail sync connect failed: ${completed.location}`);
	}
}

async function syncState(accountId: string) {
	return (
		await db
			.select()
			.from(mailSyncStates)
			.where(eq(mailSyncStates.accountId, accountId))
			.limit(1)
	)[0];
}

async function drain(accountId: string) {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		await scanMailSync();
		const state = await syncState(accountId);
		if (state?.status === "idle") return state;
		if (state?.status === "dead" || state?.status === "reauth_required") {
			throw new Error(`mail sync terminal state: ${state.status}/${state.lastErrorCode}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("mail sync drain timeout");
}

async function main() {
	if (!STUB.startsWith("http://127.0.0.1:")) throw new Error("mail sync verifier requires local provider");
	const owner = await provision("owner");
	const stranger = await provision("stranger");
	try {
		await providerControl(owner.email, "reset", { count: 28 });
		const ownerCookie = await login(owner.email, owner.password);
		const strangerCookie = await login(stranger.email, stranger.password);
		await connect(ownerCookie);
		const [account] = await db
			.select()
			.from(mailAccounts)
			.where(eq(mailAccounts.ownerUserId, owner.userId));
		if (!account) throw new Error("mail sync account missing");

		const initial = await syncState(account.id);
		check("OAuth připojení atomicky zařadí první full sync", initial?.status === "pending" && initial.syncMode === "full", initial);
		const initialGeneration = initial?.fullSyncGeneration;
		const finished = await drain(account.id);
		check(
			"vícestránkový full sync skončí idle s history cursorem",
			finished.status === "idle" && finished.syncMode === "partial" && Boolean(finished.historyId),
			finished,
		);
		const rows = await db.select().from(mailMessages).where(eq(mailMessages.accountId, account.id));
		check("full sync uložil všech 28 provider zpráv", rows.length === 28, rows.length);
		const databaseText = JSON.stringify(rows);
		check(
			"DB index neobsahuje předmět, adresu ani tělo v plaintextu",
			!databaseText.includes("Synchronizovaná zpráva") &&
				!databaseText.includes("sender-") &&
				!databaseText.includes("Text zprávy"),
		);

		let response = await request(ownerCookie, `/api/mail/accounts/${account.id}/messages?limit=10`);
		const firstPage = response.body.messages as Array<Record<string, unknown>> | undefined;
		check(
			"owner dostane dešifrovanou stránku bez surového HTML",
			response.status === 200 &&
				firstPage?.length === 10 &&
				String(firstPage[0]?.subject).startsWith("Synchronizovaná zpráva") &&
				firstPage[0]?.hasHtml === true &&
				firstPage[0]?.hasText === true &&
				!("htmlBody" in (firstPage[0] ?? {})) &&
				!("textBody" in (firstPage[0] ?? {})) &&
				!("attachments" in (firstPage[0] ?? {})) &&
				typeof response.body.nextCursor === "string",
			response,
		);
		const firstMessageId = String(firstPage?.[0]?.id ?? "");
		response = await request(
			ownerCookie,
			`/api/mail/accounts/${account.id}/messages/${firstMessageId}`,
		);
		const detail = response.body.message as Record<string, unknown> | undefined;
		check(
			"celé tělo vrací až owner-only detail a stále nikdy surové HTML",
			response.status === 200 &&
				String(detail?.textBody).startsWith("Text zprávy") &&
				detail?.hasHtml === true &&
				Array.isArray(detail?.attachments) &&
				!("htmlBody" in (detail ?? {})),
			response,
		);
		response = await request(
			strangerCookie,
			`/api/mail/accounts/${account.id}/messages/${firstMessageId}`,
		);
		check("cizí uživatel nedostane detail ani existenci zprávy", response.status === 404, response);
		response = await request(ownerCookie, `/api/mail/accounts/${account.id}/messages?limit=10`);
		response = await request(
			ownerCookie,
			`/api/mail/accounts/${account.id}/messages?limit=10&cursor=${encodeURIComponent(String(response.body.nextCursor))}`,
		);
		const secondPage = response.body.messages as Array<Record<string, unknown>> | undefined;
		check(
			"cursor stránkování neduplikuje zprávy",
			response.status === 200 &&
				secondPage?.length === 10 &&
				!secondPage.some((message) => firstPage?.some((first) => first.id === message.id)),
			response,
		);
		response = await request(strangerCookie, `/api/mail/accounts/${account.id}/messages`);
		check("cizí uživatel nedostane ani existenci mailbox zpráv", response.status === 404, response);

		await providerControl(owner.email, "label", { messageId: "msg-001" });
		await providerControl(owner.email, "delete", { messageId: "msg-002" });
		const added = await providerControl(owner.email, "add");
		response = await request(ownerCookie, `/api/mail/accounts/${account.id}/sync`, "POST");
		check("owner může idempotentně vyžádat partial sync", response.status === 202, response);
		await drain(account.id);
		const afterHistory = await db.select().from(mailMessages).where(eq(mailMessages.accountId, account.id));
		const labeled = afterHistory.find((message) => message.providerMessageId === "msg-001");
		check(
			"history sync aplikuje label, delete i add bez full reloadu",
			afterHistory.length === 28 &&
				labeled?.labelIds.includes("STARRED") === true &&
				!afterHistory.some((message) => message.providerMessageId === "msg-002") &&
				afterHistory.some((message) => message.providerMessageId === added.id),
			{ count: afterHistory.length, added, labeled: labeled?.labelIds },
		);

		const backgroundAdded = await providerControl(owner.email, "add");
		await db
			.update(mailSyncStates)
			.set({ lastSuccessAt: new Date(0) })
			.where(eq(mailSyncStates.accountId, account.id));
		await scanMailSync(new Date());
		await drain(account.id);
		const backgroundRows = await db
			.select({ id: mailMessages.providerMessageId })
			.from(mailMessages)
			.where(eq(mailMessages.accountId, account.id));
		check(
			"idle účet se periodicky synchronizuje i bez ručního tlačítka",
			backgroundRows.some((message) => message.id === backgroundAdded.id),
			{ backgroundAdded, count: backgroundRows.length },
		);

		await providerControl(owner.email, "add");
		await providerControl(owner.email, "expire");
		await request(ownerCookie, `/api/mail/accounts/${account.id}/sync`, "POST");
		const recovered = await drain(account.id);
		check(
			"vypršelý history cursor automaticky provede nový full generation",
			recovered.status === "idle" && recovered.fullSyncGeneration !== initialGeneration,
			recovered,
		);

		const beforeRefresh = await providerStats();
		await providerControl(owner.email, "invalidate_access");
		await providerControl(owner.email, "add");
		await request(ownerCookie, `/api/mail/accounts/${account.id}/sync`, "POST");
		await drain(account.id);
		const afterRefresh = await providerStats();
		check(
			"401 access token bezpečně otočí přes refresh token a sync pokračuje",
			afterRefresh.refreshes === beforeRefresh.refreshes + 1,
			{ beforeRefresh, afterRefresh },
		);

		const audits = await db
			.select({ action: auditEvents.action, diff: auditEvents.diff })
			.from(auditEvents)
			.where(and(eq(auditEvents.entity, "mail_sync"), eq(auditEvents.entityId, account.id)));
		const auditText = JSON.stringify(audits);
		check(
			"sync/recovery audit obsahuje jen počty a safe stavy",
			audits.some((event) => event.action === "full_sync_completed") &&
				audits.some((event) => event.action === "history_expired_full_sync_required") &&
				!auditText.includes("Synchronizovaná zpráva") &&
				!auditText.includes("sender-"),
			audits,
		);

		const revoke = await request(ownerCookie, `/api/mail/accounts/${account.id}/revoke`, "POST", {
			operationId: crypto.randomUUID(),
			expectedVersion: 1,
		});
		const [messagesAfterRevoke, statesAfterRevoke, credentialsAfterRevoke] = await Promise.all([
			db.select().from(mailMessages).where(eq(mailMessages.accountId, account.id)),
			db.select().from(mailSyncStates).where(eq(mailSyncStates.accountId, account.id)),
			db.select().from(mailAccountCredentials).where(eq(mailAccountCredentials.accountId, account.id)),
		]);
		check(
			"revoke po provider ACK fyzicky smaže credential, cursor i synchronizovaný obsah",
			revoke.status === 200 &&
				messagesAfterRevoke.length === 0 &&
				statesAfterRevoke.length === 0 &&
				credentialsAfterRevoke.length === 0,
			{ revoke, messages: messagesAfterRevoke.length, states: statesAfterRevoke.length },
		);
	} finally {
		for (const fixture of [owner, stranger]) {
			await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
			await db.delete(users).where(eq(users.id, fixture.userId));
		}
	}
	if (failed) throw new Error(`mail sync verifier failed: ${failed}`);
	console.log("\nMail sync: všechny kontroly prošly");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
