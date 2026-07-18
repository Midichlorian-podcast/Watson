/** Owner-only advanced mail proof: search, views, labels, identity, follow-up and analytics. */
import "./src/env";
import {
	accounts,
	and,
	eq,
	getDb,
	mailAccounts,
	mailFollowups,
	mailMessages,
	mailOutboundMessages,
	mailSavedViews,
	mailSyncStates,
	memberships,
	users,
	workspaces,
} from "@watson/db";
import { hashPassword } from "better-auth/crypto";
import { scanMailOutbound } from "./src/mailOutbound";
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
	const email = `mail-advanced-${slug}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	await db.transaction(async (tx) => {
		await tx.insert(users).values({ id: userId, name: `Mail Advanced ${slug}`, email, emailVerified: true });
		await tx.insert(accounts).values({
			id: crypto.randomUUID(), userId, accountId: email, providerId: "credential",
			password: await hashPassword(password),
		});
		await tx.insert(workspaces).values({ id: workspaceId, name: `Mail Advanced ${slug}`, ownerId: userId, isPersonal: true });
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
	if (!response.ok) throw new Error(`mail advanced login failed: ${response.status}`);
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
	try { parsed = JSON.parse(text || "{}") as Record<string, unknown>; } catch { /* OAuth redirect */ }
	return { status: response.status, body: parsed, location: response.headers.get("location") };
}

async function provider(email: string, action: string, extra: Record<string, unknown> = {}) {
	const response = await fetch(`${STUB}/test/mailbox`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, action, ...extra }),
	});
	if (!response.ok) throw new Error(`mail advanced provider ${action}: ${response.status}`);
	return (await response.json()) as Record<string, unknown>;
}

async function connect(cookie: string) {
	const started = await request(cookie, "/api/mail/oauth/google/start", "POST");
	const authorization = await fetch(String(started.body.authorizationUrl), { redirect: "manual" });
	const callback = authorization.headers.get("location");
	if (!callback) throw new Error("mail advanced callback missing");
	const result = await request(cookie, callback.replace(API, ""));
	if (!result.location?.includes("mailConnection=success")) throw new Error(`mail advanced connect failed: ${result.location}`);
}

async function drain(accountId: string) {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		await scanMailSync();
		const account = (await db.select({ status: mailAccounts.status }).from(mailAccounts).where(eq(mailAccounts.id, accountId)).limit(1))[0];
		const state = (await db.select({ status: mailSyncStates.status }).from(mailSyncStates).where(eq(mailSyncStates.accountId, accountId)).limit(1))[0];
		if (state?.status === "idle") return;
		if (state?.status === "dead" || state?.status === "reauth_required" || account?.status === "degraded") {
			throw new Error(`mail advanced sync terminal: ${state?.status}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("mail advanced sync timeout");
}

async function main() {
	const owner = await provision("owner");
	const stranger = await provision("stranger");
	try {
		await provider(owner.email, "reset", { count: 4 });
		const ownerCookie = await login(owner.email, owner.password);
		const strangerCookie = await login(stranger.email, stranger.password);
		await connect(ownerCookie);
		const account = (await db.select().from(mailAccounts).where(eq(mailAccounts.ownerUserId, owner.userId)).limit(1))[0];
		if (!account) throw new Error("mail advanced account missing");
		await drain(account.id);

		let response = await request(null, "/api/mail/search?q=sender");
		check("mailové hledání bez session selže", response.status === 401, response);
		response = await request(strangerCookie, "/api/mail/search?q=sender-2");
		check("cizí hledání neprozradí vlastníkova data", response.status === 200 && (response.body.messages as unknown[])?.length === 0, response);
		response = await request(ownerCookie, "/api/mail/search?q=from%3Asender-2%20is%3Aunread");
		const hits = response.body.messages as Array<{ id: string; subject: string; accountId: string }>;
		check("operátory from: a is:unread hledají v reálné šifrované poště", response.status === 200 && hits.length === 1 && hits[0]?.subject.includes("2"), response);
		response = await request(ownerCookie, "/api/mail/search?q=Token%20sem%20nikdy%20nepat%C5%99%C3%AD");
		check("fulltext zahrnuje dešifrované textové tělo bez plaintext indexu", response.status === 200 && (response.body.messages as unknown[])?.length === 4, response);

		response = await request(ownerCookie, "/api/mail/labels");
		const labels = response.body.labels as Array<{ providerLabelId: string; name: string }>;
		check("provider label ID zůstává namapované na lidský název", response.status === 200 && labels.some((label) => label.providerLabelId === "INBOX" && label.name === "Doručená pošta"), response);

		const viewId = crypto.randomUUID();
		response = await request(ownerCookie, "/api/mail/views", "POST", { id: viewId, name: "Důležité s přílohou", query: "is:unread has:attachment", sort: "newest" });
		check("Watson pohled se uloží autoritativně", response.status === 201 && (response.body.view as { version?: number })?.version === 1, response);
		response = await request(ownerCookie, "/api/mail/views", "POST", { id: crypto.randomUUID(), name: "Důležité s přílohou", query: "is:unread", sort: "newest" });
		check("duplicitní název pohledu je konflikt", response.status === 409, response);
		response = await request(strangerCookie, `/api/mail/views/${viewId}`, "PUT", { name: "Cizí", query: "is:unread", sort: "newest", expectedVersion: 1 });
		check("cizí uživatel pohled nezmění", response.status === 409, response);

		const detailRows = await db.select({ id: mailMessages.id, providerMessageId: mailMessages.providerMessageId }).from(mailMessages).where(and(
			eq(mailMessages.accountId, account.id),
			eq(mailMessages.providerMessageId, "msg-002"),
		)).limit(1);
		const detailId = detailRows[0]?.id;
		if (!detailId) throw new Error("mail advanced detail missing");
		response = await request(ownerCookie, `/api/mail/accounts/${account.id}/messages/${detailId}`);
		check("ověřený provider auth se zobrazí jako vysvětlitelný verified stav", response.status === 200 && (response.body.message as { security?: { level?: string } })?.security?.level === "verified", response);
		await provider(owner.email, "phishing", { messageId: "msg-002" });
		await request(ownerCookie, `/api/mail/accounts/${account.id}/sync`, "POST");
		await drain(account.id);
		response = await request(ownerCookie, `/api/mail/accounts/${account.id}/messages/${detailId}`);
		const security = (response.body.message as { security?: { level?: string; reasons?: string[] } })?.security;
		check("selhání DMARC a jiný Reply-To vyvolají konkrétní varování", response.status === 200 && security?.level === "danger" && (security.reasons?.length ?? 0) >= 2, response);

		response = await request(ownerCookie, "/api/mail/people/lookup?address=sender-1%40example.test");
		check("karta osoby odvozuje pouze ownerovu soukromou historii", response.status === 200 && (response.body.person as { messages?: number })?.messages === 1, response);
		response = await request(ownerCookie, "/api/mail/analytics?days=365");
		check("analytika vrací agregaci schránky bez skóre člověka", response.status === 200 && (response.body.total as number) >= 4 && String(response.body.note).includes("nikoli skóre"), response);

		const outboundId = crypto.randomUUID();
		response = await request(ownerCookie, `/api/mail/accounts/${account.id}/outbound`, "POST", {
			id: outboundId,
			operationId: crypto.randomUUID(),
			to: ["followup@example.test"], cc: [], bcc: [],
			subject: "Pohlídat skutečnou odpověď", textBody: "Prosím o potvrzení.", sendAt: null,
		});
		check("follow-up začíná nad skutečnou odchozí frontou", response.status === 201, response);
		await scanMailOutbound(new Date(Date.now() + 20_000));
		const accepted = (await db.select().from(mailOutboundMessages).where(eq(mailOutboundMessages.id, outboundId)).limit(1))[0];
		check("odchozí zpráva byla providerem přijata", accepted?.status === "accepted", accepted);
		response = await request(ownerCookie, `/api/mail/accounts/${account.id}/outbound/${outboundId}/followup`, "POST", {
			dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
		});
		const followup = response.body.followup as { id: string; version: number; status: string };
		check("čekání na odpověď je trvalý follow-up", response.status === 201 && followup.status === "waiting", response);
		response = await request(strangerCookie, "/api/mail/followups");
		check("cizí follow-up registr je prázdný", response.status === 200 && (response.body.followups as unknown[])?.length === 0, response);
		response = await request(ownerCookie, `/api/mail/followups/${followup.id}`, "PATCH", { status: "done", expectedVersion: followup.version });
		check("follow-up lze explicitně uzavřít přes CAS", response.status === 200 && (response.body.followup as { status?: string })?.status === "done", response);

		let guardRejected = false;
		try {
			await db.insert(mailSavedViews).values({
				workspaceId: stranger.workspaceId,
				ownerUserId: owner.userId,
				name: "Tenant violation",
				query: "is:unread",
			});
		} catch { guardRejected = true; }
		check("DB guard odmítne pohled v cizím osobním prostoru", guardRejected);

		console.log(`\nMail advanced: ${failed === 0 ? "všechny kontroly prošly" : `${failed} selhalo`}.`);
		if (failed > 0) process.exitCode = 1;
	} finally {
		await db.delete(mailFollowups).where(eq(mailFollowups.ownerUserId, owner.userId));
		await db.delete(mailSavedViews).where(eq(mailSavedViews.ownerUserId, owner.userId));
		await db.delete(workspaces).where(eq(workspaces.id, owner.workspaceId));
		await db.delete(workspaces).where(eq(workspaces.id, stranger.workspaceId));
		await db.delete(users).where(eq(users.id, owner.userId));
		await db.delete(users).where(eq(users.id, stranger.userId));
	}
}

await main();
process.exit(process.exitCode ?? 0);
