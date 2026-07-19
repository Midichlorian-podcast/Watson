/** F5/M1 proof: real Gmail outbound, Undo Send and Send Later are durable and duplicate-safe. */
import "./src/env";
import {
	accounts,
	and,
	auditEvents,
	eq,
	getDb,
	mailAccounts,
	mailMessages,
	mailOutboundMessages,
	mailSyncStates,
	memberships,
	users,
	workspaces,
} from "@watson/db";
import { hashPassword } from "better-auth/crypto";
import { encryptMailContent } from "./src/mailContentVault";
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

function sqlState(error: unknown): string | undefined {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current && typeof current === "object"; depth += 1) {
		const value = current as { code?: string; cause?: unknown };
		if (value.code) return value.code;
		current = value.cause;
	}
	return undefined;
}

async function provision(slug: string) {
	const userId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const email = `mail-outbound-${slug}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}@watson.test`;
	const password = `Watson-${crypto.randomUUID()}-A1!`;
	await db.transaction(async (tx) => {
		await tx.insert(users).values({
			id: userId,
			name: `Mail Outbound ${slug}`,
			email,
			emailVerified: true,
		});
		await tx.insert(accounts).values({
			id: crypto.randomUUID(),
			userId,
			accountId: email,
			providerId: "credential",
			password: await hashPassword(password),
		});
		await tx.insert(workspaces).values({
			id: workspaceId,
			name: `Mail Outbound ${slug}`,
			ownerId: userId,
			isPersonal: true,
		});
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
	if (!response.ok) throw new Error(`mail outbound login failed: ${response.status}`);
	return response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");
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
		// OAuth redirect.
	}
	return { status: response.status, body: parsed, location: response.headers.get("location") };
}

async function connect(cookie: string) {
	const started = await request(cookie, "/api/mail/oauth/google/start", "POST");
	const authorizationUrl = String(started.body.authorizationUrl ?? "");
	const provider = await fetch(authorizationUrl, { redirect: "manual" });
	const callback = provider.headers.get("location");
	if (!callback) throw new Error("mail outbound provider callback missing");
	const completed = await request(cookie, callback.replace(API, ""));
	if (!completed.location?.includes("mailConnection=success")) {
		throw new Error(`mail outbound connect failed: ${completed.location}`);
	}
}

async function resetMailbox(email: string) {
	const response = await fetch(`${STUB}/test/mailbox`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, action: "reset", count: 0 }),
	});
	if (!response.ok) throw new Error(`mail outbound mailbox reset failed: ${response.status}`);
}

async function sent(email: string) {
	const response = await fetch(`${STUB}/test/sent?email=${encodeURIComponent(email)}`);
	if (!response.ok) throw new Error(`mail outbound sent inspection failed: ${response.status}`);
	return (await response.json()) as {
		messages: Array<{ id: string; threadId: string; messageId: string; raw: string }>;
	};
}

function command(
	to: string,
	overrides: Partial<{
		id: string;
		operationId: string;
		cc: string[];
		bcc: string[];
		subject: string;
		textBody: string;
		sendAt: string | null;
		replyToMessageId: string | null;
	}> = {},
) {
	return {
		id: overrides.id ?? crypto.randomUUID(),
		operationId: overrides.operationId ?? crypto.randomUUID(),
		to: [to],
		cc: overrides.cc ?? [],
		bcc: overrides.bcc ?? [],
		subject: overrides.subject ?? "Watson odchozí důkaz",
		textBody: overrides.textBody ?? "Citlivé tělo odchozího e-mailu.",
		...(overrides.sendAt === undefined ? {} : { sendAt: overrides.sendAt }),
		...(overrides.replyToMessageId === undefined ? {} : { replyToMessageId: overrides.replyToMessageId }),
	};
}

function outboundBody(response: Awaited<ReturnType<typeof request>>) {
	return response.body.outbound as
		| {
				id: string;
				status: string;
				version: number;
				providerMessageId?: string | null;
				lastErrorCode?: string | null;
		  }
		| undefined;
}

async function row(id: string) {
	return (
		await db.select().from(mailOutboundMessages).where(eq(mailOutboundMessages.id, id)).limit(1)
	)[0];
}

async function enqueue(cookie: string, accountId: string, payload: ReturnType<typeof command>) {
	return request(cookie, `/api/mail/accounts/${accountId}/outbound`, "POST", payload);
}

async function settleInitialSync(accountId: string) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		await scanMailSync();
		const state = (
			await db
				.select()
				.from(mailSyncStates)
				.where(eq(mailSyncStates.accountId, accountId))
				.limit(1)
		)[0];
		if (state?.status === "idle" && state.syncMode === "partial") return state;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("mail outbound initial sync did not settle");
}

async function main() {
	const owner = await provision("owner");
	const stranger = await provision("stranger");
	try {
		await resetMailbox(owner.email);
		const ownerCookie = await login(owner.email, owner.password);
		const strangerCookie = await login(stranger.email, stranger.password);
		await connect(ownerCookie);
		const account = (
			await db
				.select()
				.from(mailAccounts)
				.where(eq(mailAccounts.ownerUserId, owner.userId))
				.limit(1)
		)[0];
		if (!account) throw new Error("mail outbound account missing");
		const syncState = await settleInitialSync(account.id);
		const replySourceId = crypto.randomUUID();
		const replyProviderId = "reply-source-001";
		const replyThreadId = "thread-reply-source-001";
		const replySourceContent = {
			subject: "Původní zpráva",
			from: "Původní odesílatel <reply-source@example.test>",
			to: [owner.email],
			cc: [],
			replyTo: "",
			dateHeader: new Date().toUTCString(),
			authenticationResults: "spf=pass; dkim=pass; dmarc=pass",
			returnPath: "<reply-source@example.test>",
			messageIdHeader: "<reply-source@example.test>",
			references: ["<reply-root@example.test>"],
			snippet: "Původní zpráva",
			textBody: "Původní text, který se nesmí propsat do auditu.",
			htmlBody: "",
			attachments: [],
		};
		await db.insert(mailMessages).values({
			id: replySourceId,
			accountId: account.id,
			providerMessageId: replyProviderId,
			providerThreadId: replyThreadId,
			historyId: "999001",
			internalDate: new Date(),
			labelIds: ["INBOX"],
			sizeEstimate: 512,
			lastSeenSyncGeneration: syncState.fullSyncGeneration,
			...encryptMailContent(
				{ accountId: account.id, provider: "google", providerMessageId: replyProviderId },
				replySourceContent,
			),
		});

		let response = await request(null, `/api/mail/accounts/${account.id}/outbound`);
		check("odchozí registr je bez session fail-closed", response.status === 401, response);
		response = await request(strangerCookie, `/api/mail/accounts/${account.id}/outbound`);
		check("cizí uživatel nevidí ani existenci odchozí fronty", response.status === 404, response);

		const undoPayload = command("undo@example.test", {
			cc: ["copy@example.test"],
			bcc: ["blind@example.test"],
			subject: "Citlivý předmět pro Undo",
			textBody: "Citlivé tělo pro Undo se nesmí objevit v plaintext DB.",
		});
		response = await enqueue(ownerCookie, account.id, undoPayload);
		const queuedUndo = outboundBody(response);
		check(
			"odeslání vznikne nejprve ve vratném Undo okně",
			response.status === 201 && queuedUndo?.status === "queued" && queuedUndo.version === 1,
			response,
		);
		const storedUndo = await row(undoPayload.id);
		const storedJson = JSON.stringify(storedUndo);
		check(
			"příjemci, předmět a tělo jsou v DB pouze šifrované",
			Boolean(storedUndo?.ciphertext) &&
				!storedJson.includes("undo@example.test") &&
				!storedJson.includes(undoPayload.subject) &&
				!storedJson.includes(undoPayload.textBody),
			storedUndo,
		);
		response = await enqueue(ownerCookie, account.id, undoPayload);
		check(
			"přesný enqueue retry je idempotentní",
			response.status === 200 && response.body.replayed === true,
			response,
		);
		response = await enqueue(ownerCookie, account.id, { ...undoPayload, subject: "Jiný obsah" });
		check("operation ID nelze znovu použít pro jiný obsah", response.status === 409, response);
		await scanMailOutbound(new Date(Date.now() + 1_000));
		check("worker před koncem Undo okna nic neodešle", (await sent(owner.email)).messages.length === 0);
		const cancelOperation = crypto.randomUUID();
		response = await request(
			ownerCookie,
			`/api/mail/accounts/${account.id}/outbound/${undoPayload.id}/cancel`,
			"POST",
			{ operationId: cancelOperation, expectedVersion: 1 },
		);
		check("Undo atomicky zruší čekající zprávu", response.status === 200, response);
		response = await request(
			ownerCookie,
			`/api/mail/accounts/${account.id}/outbound/${undoPayload.id}/cancel`,
			"POST",
			{ operationId: cancelOperation, expectedVersion: 1 },
		);
		check("opakované Undo vrací stejný receipt", response.status === 200, response);
		await scanMailOutbound(new Date(Date.now() + 60_000));
		check("zrušená zpráva se neodešle ani po termínu", (await sent(owner.email)).messages.length === 0);

		const normalPayload = command("recipient@example.test", {
			cc: ["copy@example.test"],
			bcc: ["blind@example.test"],
			subject: "Žluťoučký kůň",
			textBody: "Příliš žluťoučký kůň úpěl ďábelské ódy.",
		});
		response = await enqueue(ownerCookie, account.id, normalPayload);
		check("běžná zpráva vstoupí do fronty", response.status === 201, response);
		const due = new Date(Date.now() + 60_000);
		await Promise.all([scanMailOutbound(due), scanMailOutbound(due)]);
		const normalRow = await row(normalPayload.id);
		const sentAfterNormal = await sent(owner.email);
		const normalSent = sentAfterNormal.messages.find(
			(item) => item.messageId === `watson-${normalPayload.id}@watson.invalid`,
		);
		check(
			"paralelní workery odešlou zprávu právě jednou a uloží provider ACK",
			normalRow?.status === "accepted" &&
				normalRow.attempts === 1 &&
				Boolean(normalRow.providerMessageId) &&
				sentAfterNormal.messages.length === 1,
			{ normalRow, sentAfterNormal },
		);
			check(
				"provider dostane korektní MIME s To/Cc/Bcc, stabilním ID a UTF-8 tělem",
			Boolean(normalSent) &&
				/^To: recipient@example\.test$/m.test(normalSent?.raw ?? "") &&
				/^Cc: copy@example\.test$/m.test(normalSent?.raw ?? "") &&
				/^Bcc: blind@example\.test$/m.test(normalSent?.raw ?? "") &&
				(normalSent?.raw ?? "").includes(`Message-ID: <watson-${normalPayload.id}@watson.invalid>`) &&
				(normalSent?.raw ?? "").includes(
					Buffer.from(normalPayload.textBody, "utf8").toString("base64"),
				),
				normalSent,
			);

			const missingReply = command("reply@example.test", {
				replyToMessageId: crypto.randomUUID(),
				subject: "Re: neexistující zpráva",
			});
			response = await enqueue(ownerCookie, account.id, missingReply);
			check("odpověď nelze navázat na cizí nebo neexistující zprávu", response.status === 404, response);
			const replyPayload = command("reply-source@example.test", {
				replyToMessageId: replySourceId,
				subject: "Re: Původní zpráva",
				textBody: "Bezpečná odpověď ve vlákně.",
			});
			response = await enqueue(ownerCookie, account.id, replyPayload);
			check("odpověď vstoupí do stejné šifrované Undo fronty", response.status === 201, response);
			await scanMailOutbound(due);
			const threadedSent = (await sent(owner.email)).messages.find(
				(item) => item.messageId === `watson-${replyPayload.id}@watson.invalid`,
			);
			check(
				"server odvodí RFC hlavičky a provider thread pouze z ownerovy zdrojové zprávy",
				Boolean(threadedSent) &&
					threadedSent?.threadId === replyThreadId &&
					/^In-Reply-To: <reply-source@example\.test>$/m.test(threadedSent.raw) &&
					/^References: <reply-root@example\.test> <reply-source@example\.test>$/m.test(threadedSent.raw),
				threadedSent,
			);
		response = await request(ownerCookie, `/api/mail/accounts/${account.id}/outbound`);
		const listed = response.body.outbound as Array<Record<string, unknown>> | undefined;
		check(
			"ownerův registr dešifruje bezpečný přehled vlastních odeslání",
			response.status === 200 &&
				listed?.some(
					(item) => item.id === normalPayload.id && item.subject === normalPayload.subject && item.status === "accepted",
				) === true,
			response,
		);

		const laterPayload = command("later@example.test", {
			sendAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
			subject: "Send Later",
		});
		response = await enqueue(ownerCookie, account.id, laterPayload);
		const queuedLater = outboundBody(response);
		await scanMailOutbound(new Date(Date.now() + 60_000));
		check(
			"Send Later se před plánem neodešle",
			queuedLater?.status === "queued" && (await row(laterPayload.id))?.status === "queued",
		);
		response = await request(
			ownerCookie,
			`/api/mail/accounts/${account.id}/outbound/${laterPayload.id}/cancel`,
			"POST",
			{ operationId: crypto.randomUUID(), expectedVersion: queuedLater?.version },
		);
		check("naplánovanou zprávu lze před odesláním zrušit", response.status === 200, response);

		const ratePayload = command("rate-limit-once@example.test", { subject: "429 retry" });
		await enqueue(ownerCookie, account.id, ratePayload);
		await scanMailOutbound(due);
		const rateRetry = await row(ratePayload.id);
		check(
			"jednoznačné 429 přejde do omezeného retry",
			rateRetry?.status === "retry" && rateRetry.lastErrorCode === "mail_rate_limited",
			rateRetry,
		);
		await scanMailOutbound(new Date(Date.now() + 5 * 60_000));
		const rateAccepted = await row(ratePayload.id);
		const rateSent = (await sent(owner.email)).messages.filter(
			(item) => item.messageId === `watson-${ratePayload.id}@watson.invalid`,
		);
		check(
			"429 retry uspěje bez duplicitního provider přijetí",
			rateAccepted?.status === "accepted" && rateAccepted.attempts === 2 && rateSent.length === 1,
			{ rateAccepted, rateSent },
		);

		const uncertainPayload = command("uncertain@example.test", { subject: "Nejistý ACK" });
		await enqueue(ownerCookie, account.id, uncertainPayload);
		await scanMailOutbound(due);
		const uncertainRow = await row(uncertainPayload.id);
		await scanMailOutbound(new Date(Date.now() + 10 * 60_000));
		const uncertainSent = (await sent(owner.email)).messages.filter(
			(item) => item.messageId === `watson-${uncertainPayload.id}@watson.invalid`,
		);
		check(
			"5xx po možném přijetí končí jako uncertain a nikdy se automaticky neopakuje",
			uncertainRow?.status === "uncertain" && uncertainRow.attempts === 1 && uncertainSent.length === 1,
			{ uncertainRow, uncertainSent },
		);

		const malformedPayload = command("malformed-send@example.test", { subject: "Vadný ACK" });
		await enqueue(ownerCookie, account.id, malformedPayload);
		await scanMailOutbound(due);
		const malformedRow = await row(malformedPayload.id);
		check(
			"vadný 2xx provider ACK se bezpečně nezamění za úspěch",
			malformedRow?.status === "uncertain" && malformedRow.lastErrorCode === "mail_contract_rejected",
			malformedRow,
		);

		const stalePayload = command("stale@example.test", { subject: "Mrtvý lease" });
		await enqueue(ownerCookie, account.id, stalePayload);
		const staleStored = await row(stalePayload.id);
		if (!staleStored) throw new Error("stale outbound fixture missing");
		await db
			.update(mailOutboundMessages)
			.set({
				status: "sending",
				leaseToken: crypto.randomUUID(),
				leaseUntil: new Date(Date.now() - 60_000),
				attempts: 1,
				version: staleStored.version + 1,
			})
			.where(eq(mailOutboundMessages.id, stalePayload.id));
		await scanMailOutbound(due);
		const staleRecovered = await row(stalePayload.id);
		check(
			"expirovaný sending lease je uncertain, nikoli slepě retry",
			staleRecovered?.status === "uncertain" && staleRecovered.attempts === 1,
			staleRecovered,
		);

		let scopeState: string | undefined;
		try {
			await db.insert(mailOutboundMessages).values({
				id: crypto.randomUUID(),
				workspaceId: stranger.workspaceId,
				accountId: account.id,
				ownerUserId: owner.userId,
				operationId: crypto.randomUUID(),
				requestHash: "a".repeat(64),
				status: "queued",
				scheduledFor: new Date(Date.now() + 60_000),
				undoUntil: new Date(Date.now() + 10_000),
				algorithm: staleStored.algorithm,
				keyId: staleStored.keyId,
				nonce: staleStored.nonce,
				authTag: staleStored.authTag,
				ciphertext: staleStored.ciphertext,
			});
		} catch (error) {
			scopeState = sqlState(error);
		}
		check("DB trigger odmítne cross-workspace odchozí scope", scopeState === "23514", scopeState);

		const events = await db
			.select()
			.from(auditEvents)
			.where(
				and(
					eq(auditEvents.workspaceId, owner.workspaceId),
					eq(auditEvents.entity, "mail_outbound"),
				),
			);
		const auditJson = JSON.stringify(events);
		check(
			"audit zachytí lifecycle bez příjemců, předmětu a těla",
			events.some((event) => event.action === "provider_accepted") &&
				!auditJson.includes("recipient@example.test") &&
				!auditJson.includes(normalPayload.subject) &&
				!auditJson.includes(normalPayload.textBody),
			events,
		);

		const revokePayload = command("revoked@example.test", { subject: "Zrušit s účtem" });
		await enqueue(ownerCookie, account.id, revokePayload);
		response = await request(ownerCookie, `/api/mail/accounts/${account.id}/revoke`, "POST", {
			operationId: crypto.randomUUID(),
			expectedVersion: account.version,
		});
		check(
			"revoke účtu atomicky zruší neodeslanou frontu",
			response.status === 200 && (await row(revokePayload.id))?.status === "cancelled",
			response,
		);

		console.log(`\nMail outbound: ${failed === 0 ? "OK" : `${failed} selhání`}`);
		if (failed > 0) process.exitCode = 1;
	} finally {
		await db.delete(users).where(eq(users.id, stranger.userId));
		await db.delete(users).where(eq(users.id, owner.userId));
	}
}

main()
	.then(() => process.exit(failed > 0 ? 1 : 0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
