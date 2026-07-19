/** Encrypted explicit-share draft, concurrent edit, approval and exact-send proof. */
import "./src/env";
import {
	accounts,
	and,
	auditEvents,
	eq,
	getDb,
	mailAccounts,
	mailOutboundMessages,
	mailSharedDraftApprovals,
	mailSharedDrafts,
	memberships,
	users,
	workspaces,
} from "@watson/db";
import { hashPassword } from "better-auth/crypto";
import { scanMailOutbound } from "./src/mailOutbound";

const API = process.env.MAIL_API ?? "http://127.0.0.1:8790";
const STUB = process.env.MAIL_GOOGLE_API_BASE_URL ?? "http://127.0.0.1:8793";
const db = getDb();
let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else { failed += 1; console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`); }
};

async function user(slug: string) {
	const id = crypto.randomUUID();
	const email = `mail-draft-${slug}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	await db.insert(users).values({ id, name: `Draft ${slug}`, email, emailVerified: true });
	await db.insert(accounts).values({ id: crypto.randomUUID(), userId: id, accountId: email, providerId: "credential", password: await hashPassword(password) });
	return { id, email, password };
}

async function login(fixture: Awaited<ReturnType<typeof user>>) {
	const response = await fetch(`${API}/api/auth/sign-in/email`, {
		method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
		body: JSON.stringify({ email: fixture.email, password: fixture.password }),
	});
	if (!response.ok) throw new Error(`draft login ${response.status}`);
	return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

async function request(cookie: string | null, path: string, method = "GET", body?: unknown) {
	const url = /^https?:\/\//.test(path) ? path : `${API}${path}`;
	const response = await fetch(url, {
		method, redirect: "manual",
		headers: { Origin: "http://localhost:5173", ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let parsed: Record<string, unknown> = {};
	try { parsed = JSON.parse(text || "{}") as Record<string, unknown>; } catch { /* OAuth redirect */ }
	return { status: response.status, body: parsed, location: response.headers.get("location") };
}

async function connect(cookie: string) {
	const start = await request(cookie, "/api/mail/oauth/google/start", "POST");
	const provider = await fetch(String(start.body.authorizationUrl), { redirect: "manual" });
	const callback = provider.headers.get("location");
	if (!callback) throw new Error("draft callback missing");
	const result = await request(cookie, callback);
	if (!result.location?.includes("mailConnection=success")) throw new Error(`draft connect ${result.location}`);
}

type PublicDraft = {
	id: string; status: string; version: number; contentVersion: number; content?: { subject: string; textBody: string };
	viewerRole: string; outboundId?: string | null; outboundStatus?: string | null;
	approvals: Array<{ approverUserId: string; status: string; decidedContentVersion: number | null }>;
};
const asDraft = (response: Awaited<ReturnType<typeof request>>) => response.body.draft as PublicDraft;

async function main() {
	const owner = await user("owner");
	const editor = await user("editor");
	const approver = await user("approver");
	const stranger = await user("stranger");
	const personalWorkspaceId = crypto.randomUUID();
	const teamWorkspaceId = crypto.randomUUID();
	try {
		await db.transaction(async (tx) => {
			await tx.insert(workspaces).values({ id: personalWorkspaceId, name: "Draft owner personal", ownerId: owner.id, isPersonal: true });
			await tx.insert(workspaces).values({ id: teamWorkspaceId, name: "Draft approval team", ownerId: owner.id, isPersonal: false });
			await tx.insert(memberships).values([
				{ workspaceId: personalWorkspaceId, userId: owner.id, role: "admin" },
				{ workspaceId: teamWorkspaceId, userId: owner.id, role: "admin" },
				{ workspaceId: teamWorkspaceId, userId: editor.id, role: "member" },
				{ workspaceId: teamWorkspaceId, userId: approver.id, role: "manager" },
			]);
		});
		const ownerCookie = await login(owner);
		const editorCookie = await login(editor);
		const approverCookie = await login(approver);
		const strangerCookie = await login(stranger);
		await connect(ownerCookie);
		const account = (await db.select().from(mailAccounts).where(eq(mailAccounts.ownerUserId, owner.id)).limit(1))[0];
		if (!account) throw new Error("draft account missing");

		let response = await request(null, "/api/mail/shared-drafts");
		check("sdílené drafty vyžadují session", response.status === 401, response);
		response = await request(ownerCookie, "/api/mail/shared-drafts/options");
		const options = response.body.workspaces as Array<{ id: string; members: Array<{ userId: string }> }>;
		check("volby nabízejí jen týmový prostor a jeho členy", response.status === 200 && options.length === 1 && options[0]?.id === teamWorkspaceId && options[0].members.length === 2, response);

		const draftId = crypto.randomUUID();
		const original = {
			to: ["client@example.test"], cc: [], bcc: [],
			subject: "Citlivý sdílený návrh", textBody: "První citlivá verze odpovědi.",
		};
		response = await request(ownerCookie, "/api/mail/shared-drafts", "POST", {
			id: draftId, workspaceId: teamWorkspaceId, accountId: account.id,
			content: original, editors: [editor.id], approvers: [approver.id], requiredApprovals: 1,
		});
		let draft = asDraft(response);
		check("vlastník výslovně sdílí právě jeden šifrovaný draft", response.status === 201 && draft.viewerRole === "owner" && draft.status === "draft", response);
		const stored = (await db.select().from(mailSharedDrafts).where(eq(mailSharedDrafts.id, draftId)).limit(1))[0];
		check("příjemci, předmět a tělo nejsou v plaintext DB", Boolean(stored?.ciphertext) && !JSON.stringify(stored).includes(original.subject) && !JSON.stringify(stored).includes(original.textBody), stored);
		response = await request(strangerCookie, `/api/mail/shared-drafts/${draftId}`);
		check("nepozvaný člen nevidí ani existenci draftu", response.status === 404, response);
		response = await request(approverCookie, `/api/mail/shared-drafts/${draftId}`);
		check("approver vidí explicitně sdílený obsah, ne schránku", response.status === 200 && asDraft(response).viewerRole === "approver", response);

		response = await request(editorCookie, `/api/mail/shared-drafts/${draftId}`, "PUT", {
			expectedVersion: draft.version,
			content: { ...original, textBody: "Druhá verze připravená editorem." },
		});
		draft = asDraft(response);
		check("editor upraví obsah přes CAS a zvýší content version", response.status === 200 && draft.contentVersion === 2 && draft.content?.textBody.includes("Druhá verze"), response);
		response = await request(ownerCookie, `/api/mail/shared-drafts/${draftId}`, "PUT", {
			expectedVersion: 1, content: original,
		});
		check("souběžná zastaralá editace nepřepíše novější práci", response.status === 409, response);

		response = await request(editorCookie, `/api/mail/shared-drafts/${draftId}/submit`, "POST", { expectedVersion: draft.version });
		draft = asDraft(response);
		check("editor odešle konkrétní verzi ke schválení", response.status === 200 && draft.status === "pending_approval", response);
		response = await request(editorCookie, `/api/mail/shared-drafts/${draftId}/decision`, "POST", { expectedVersion: draft.version, decision: "approved" });
		check("editor bez approver role nerozhodne", response.status === 403, response);
		response = await request(approverCookie, `/api/mail/shared-drafts/${draftId}/decision`, "POST", { expectedVersion: draft.version, decision: "approved" });
		draft = asDraft(response);
		check("určený approver schválí přesnou content version", response.status === 200 && draft.status === "approved" && draft.approvals.some((item) => item.status === "approved" && item.decidedContentVersion === 2), response);
		response = await request(editorCookie, `/api/mail/shared-drafts/${draftId}`, "PUT", { expectedVersion: draft.version, content: original });
		check("schválený obsah je pro editaci zamčený", response.status === 409, response);
		response = await request(approverCookie, `/api/mail/shared-drafts/${draftId}/send`, "POST", { expectedVersion: draft.version, outboundId: crypto.randomUUID(), operationId: crypto.randomUUID() });
		check("approver nemůže odeslat z vlastníkova účtu", response.status === 404, response);

		const outboundId = crypto.randomUUID();
		const operationId = crypto.randomUUID();
		response = await request(ownerCookie, `/api/mail/shared-drafts/${draftId}/send`, "POST", { expectedVersion: draft.version, outboundId, operationId });
		draft = asDraft(response);
		check("vlastník zařadí jen schválenou verzi do skutečné Undo fronty", response.status === 201 && draft.status === "queued" && draft.outboundId === outboundId, response);
		response = await request(ownerCookie, `/api/mail/shared-drafts/${draftId}/send`, "POST", { expectedVersion: draft.version, outboundId, operationId });
		check("ztracená odpověď send je idempotentní", response.status === 200 && response.body.replayed === true, response);
		await scanMailOutbound(new Date(Date.now() + 20_000));
		const outbound = (await db.select().from(mailOutboundMessages).where(eq(mailOutboundMessages.id, outboundId)).limit(1))[0];
		check("provider přijal schválený draft", outbound?.status === "accepted", outbound);
		const sentResponse = await fetch(`${STUB}/test/sent?email=${encodeURIComponent(owner.email)}`);
		const sent = (await sentResponse.json()) as { messages: Array<{ raw: string }> };
		const approvedBodyBase64 = Buffer.from("Druhá verze připravená editorem.", "utf8").toString("base64");
		const originalBodyBase64 = Buffer.from(original.textBody, "utf8").toString("base64");
		check("provider dostal právě editorovu schválenou verzi", sent.messages.some((message) => message.raw.includes(approvedBodyBase64) && !message.raw.includes(originalBodyBase64)), sent);

		const cancelledId = crypto.randomUUID();
		response = await request(ownerCookie, "/api/mail/shared-drafts", "POST", {
			id: cancelledId, workspaceId: teamWorkspaceId, accountId: account.id,
			content: { ...original, subject: "Koncept určený ke zrušení" }, editors: [editor.id], approvers: [approver.id], requiredApprovals: 1,
		});
		const cancellable = asDraft(response);
		response = await request(ownerCookie, `/api/mail/shared-drafts/${cancelledId}/cancel`, "POST", { expectedVersion: cancellable.version });
		check("vlastník zruší neodeslaný koncept se zachováním auditu", response.status === 200 && asDraft(response).status === "cancelled", response);
		response = await request(editorCookie, `/api/mail/shared-drafts/${cancelledId}`, "PUT", { expectedVersion: asDraft(response).version, content: original });
		check("zrušený koncept už editor nemůže změnit", response.status === 409, response);

		const audits = await db.select().from(auditEvents).where(and(eq(auditEvents.entity, "mail_shared_draft"), eq(auditEvents.entityId, draftId)));
		check("vytvoření, editace, submit, approval a send jsou auditované bez obsahu", ["created", "content_updated", "submitted_for_approval", "approved", "approved_content_queued"].every((action) => audits.some((event) => event.action === action)) && !JSON.stringify(audits).includes("Druhá verze"), audits);

		console.log(`\nMail shared drafts: ${failed === 0 ? "všechny kontroly prošly" : `${failed} selhalo`}.`);
		if (failed > 0) process.exitCode = 1;
	} finally {
		await db.delete(mailSharedDraftApprovals).where(eq(mailSharedDraftApprovals.approverUserId, approver.id));
		await db.delete(workspaces).where(eq(workspaces.id, teamWorkspaceId));
		await db.delete(workspaces).where(eq(workspaces.id, personalWorkspaceId));
		await db.delete(users).where(eq(users.id, owner.id));
		await db.delete(users).where(eq(users.id, editor.id));
		await db.delete(users).where(eq(users.id, approver.id));
		await db.delete(users).where(eq(users.id, stranger.id));
	}
}

await main();
process.exit(process.exitCode ?? 0);
