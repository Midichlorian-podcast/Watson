/** F8c end-to-end proof: API keys, scope isolation, idempotency, outbox and signed delivery. */
import "./src/env";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import {
	apiClients,
	eq,
	getDb,
	memberships,
	projects,
	sql,
	tasks,
	users,
	webhookEvents,
	workspaces,
} from "@watson/db";
import { isPublicWebhookAddress, runWebhookWorkerOnce } from "./src/webhookDelivery";

const API = process.env.PUBLIC_API_URL ?? "http://127.0.0.1:8790";
const ORIGIN = process.env.WEB_ORIGIN?.split(",")[0] ?? "http://localhost:5173";
const db = getDb();
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed++;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
}

async function login(email: string): Promise<string> {
	const requested = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: ORIGIN },
		body: JSON.stringify({ email, callbackURL: `${ORIGIN}/` }),
	});
	if (!requested.ok) throw new Error(`magic-link failed: ${requested.status}`);
	const rows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as unknown as { identifier: string }[];
	const verified = await fetch(
		`${API}/api/auth/magic-link/verify?token=${rows[0]?.identifier}&callbackURL=${encodeURIComponent(`${ORIGIN}/`)}`,
		{ redirect: "manual" },
	);
	const raw = verified.headers.getSetCookie?.().join("; ") ?? verified.headers.get("set-cookie") ?? "";
	const cookie = raw
		.split(/,(?=\s*\w+=)/)
		.map((part) => part.split(";")[0]?.trim())
		.filter(Boolean)
		.join("; ");
	if (!cookie) throw new Error("missing session cookie");
	return cookie;
}

async function sessionRequest(cookie: string, path: string, method = "GET", body?: unknown) {
	const response = await fetch(`${API}${path}`, {
		method,
		headers: {
			Origin: ORIGIN,
			Cookie: cookie,
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	return { response, text, body: JSON.parse(text || "{}") as Record<string, unknown> };
}

async function publicRequest(token: string, path: string, method = "GET", body?: unknown, key?: string) {
	const response = await fetch(`${API}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
			...(key ? { "Idempotency-Key": key } : {}),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	return { response, text, body: JSON.parse(text || "{}") as Record<string, unknown> };
}

type Captured = { body: string; headers: Record<string, string | string[] | undefined> };

async function main() {
	const captured: Captured[] = [];
	const receiver = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => {
			captured.push({ body: Buffer.concat(chunks).toString("utf8"), headers: request.headers });
			response.writeHead(204).end();
		});
	});
	await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
	const address = receiver.address();
	if (!address || typeof address === "string") throw new Error("receiver did not bind");

	const stamp = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const [owner] = await db
		.insert(users)
		.values({
			name: "Public API owner",
			email: `public-api-${stamp}@watson.test`,
			emailVerified: true,
		})
		.returning({ id: users.id, email: users.email });
	if (!owner) throw new Error("owner missing");
	const [workspace] = await db
		.insert(workspaces)
		.values({ name: `Public API ${stamp}`, ownerId: owner.id })
		.returning({ id: workspaces.id });
	if (!workspace) throw new Error("workspace missing");
	await db.insert(memberships).values({ workspaceId: workspace.id, userId: owner.id, role: "admin" });
	const [allowedProject, hiddenProject] = await db
		.insert(projects)
		.values([
			{ workspaceId: workspace.id, ownerId: owner.id, name: "Allowed project" },
			{ workspaceId: workspace.id, ownerId: owner.id, name: "Hidden project" },
		])
		.returning({ id: projects.id });
	if (!allowedProject || !hiddenProject) throw new Error("projects missing");

	try {
		const cookie = await login(owner.email);
		const openapi = await fetch(`${API}/public/v1/openapi.json`);
		check(
			"OpenAPI dokumentace je veřejná, verzovaná a cacheovatelná",
			openapi.status === 200 && openapi.headers.get("cache-control")?.includes("max-age=300") === true,
			{ status: openapi.status, cache: openapi.headers.get("cache-control") },
		);
		const unauthenticated = await fetch(`${API}/public/v1/projects`);
		check(
			"datová route bez bearer tokenu selže s WWW-Authenticate",
			unauthenticated.status === 401 && unauthenticated.headers.get("www-authenticate")?.includes("invalid_token") === true,
		);

		let result = await sessionRequest(cookie, "/api/developer/clients", "POST", {
			workspaceId: workspace.id,
			name: "Reporting bridge",
			scopes: ["projects:read", "tasks:read", "tasks:write"],
			projectIds: [allowedProject.id],
		});
		const token = result.body.token as string | undefined;
		const client = result.body.client as Record<string, unknown> | undefined;
		check(
			"admin vytvoří projektově omezený klíč a token dostane jednou",
			result.response.status === 201 && token?.startsWith("wtn_live_") === true && client?.id != null,
			result.body,
		);
		if (!token || typeof client?.id !== "string") throw new Error("client create failed");
		const persisted = await db.select().from(apiClients).where(eq(apiClients.id, client.id));
		check(
			"databáze drží jen hash, ne bearer token",
			persisted.length === 1 && persisted[0]?.keyHash !== token && !JSON.stringify(persisted[0]).includes(token),
		);

		result = await publicRequest(token, "/public/v1/projects");
		const listedProjects = result.body.data as Array<Record<string, unknown>> | undefined;
		check(
			"allowlist nepropustí druhý projekt stejného workspace",
			result.response.status === 200 &&
				listedProjects?.length === 1 &&
				listedProjects[0]?.id === allowedProject.id &&
				!result.text.includes(hiddenProject.id),
			result.body,
		);

		result = await sessionRequest(cookie, "/api/developer/webhooks", "POST", {
			workspaceId: workspace.id,
			name: "Local receiver",
			endpointUrl: `http://127.0.0.1:${address.port}/watson-events`,
			eventTypes: ["task.created", "task.updated"],
			projectIds: [allowedProject.id],
		});
		const signingSecret = result.body.signingSecret as string | undefined;
		const subscription = result.body.subscription as Record<string, unknown> | undefined;
		check(
			"webhook vrátí samostatný one-time signing secret",
			result.response.status === 201 && signingSecret?.startsWith("whsec_") === true,
			result.body,
		);
		if (!signingSecret || typeof subscription?.id !== "string") throw new Error("webhook create failed");

		const operation = `create:${crypto.randomUUID()}`;
		result = await publicRequest(
			token,
			"/public/v1/tasks",
			"POST",
			{ projectId: allowedProject.id, name: "Created through API", priority: 2 },
			operation,
		);
		const createdTask = (result.body.data ?? {}) as Record<string, unknown>;
		check("API vytvoří úkol a vrátí 201", result.response.status === 201 && typeof createdTask.id === "string", result.body);
		const replay = await publicRequest(
			token,
			"/public/v1/tasks",
			"POST",
			{ projectId: allowedProject.id, name: "Created through API", priority: 2 },
			operation,
		);
		check(
			"retry se stejným klíčem vrátí stejný objekt bez duplicity",
			replay.response.status === 201 &&
				(replay.body.data as Record<string, unknown> | undefined)?.id === createdTask.id &&
				(await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, String(createdTask.id)))).length === 1,
			replay.body,
		);
		const reused = await publicRequest(
			token,
			"/public/v1/tasks",
			"POST",
			{ projectId: allowedProject.id, name: "Different payload" },
			operation,
		);
		check("idempotency key nelze recyklovat pro jiný payload", reused.response.status === 409 && reused.body.error === "idempotency_key_reused", reused.body);
		const escaped = await publicRequest(
			token,
			"/public/v1/tasks",
			"POST",
			{ projectId: hiddenProject.id, name: "Must not exist" },
			`escape:${crypto.randomUUID()}`,
		);
		check("write scope neobchází projektovou allowlist", escaped.response.status === 403, escaped.body);

		for (let attempt = 0; captured.length === 0 && attempt < 20; attempt++) {
			await runWebhookWorkerOnce();
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		const delivery = captured.find((item) => item.headers["watson-event-id"] === createdTask.id) ?? captured[0];
		const timestamp = String(delivery?.headers["watson-timestamp"] ?? "");
		const signature = String(delivery?.headers["watson-signature"] ?? "");
		const expected = delivery
			? `v1=${createHmac("sha256", signingSecret).update(`${timestamp}.${delivery.body}`).digest("hex")}`
			: "missing";
		check(
			"outbox doručí stabilní event s ověřitelným HMAC podpisem",
			Boolean(delivery) && signature === expected && JSON.parse(delivery?.body ?? "{}").type === "task.created",
			{ captured: captured.length, signature },
		);
		const secondCreate = await publicRequest(
			token,
			"/public/v1/tasks",
			"POST",
			{ projectId: allowedProject.id, name: "Second paged task" },
			`page:${crypto.randomUUID()}`,
		);
		check("druhý úkol pro cursor stránkování vznikl", secondCreate.response.status === 201, secondCreate.body);
		const firstPage = await publicRequest(token, "/public/v1/tasks?limit=1");
		const firstPageData = firstPage.body.data as Array<Record<string, unknown>> | undefined;
		const cursor = firstPage.body.nextCursor as string | null | undefined;
		const secondPage = cursor
			? await publicRequest(token, `/public/v1/tasks?limit=1&cursor=${encodeURIComponent(cursor)}`)
			: null;
		const secondPageData = secondPage?.body.data as Array<Record<string, unknown>> | undefined;
		check(
			"cursor je stabilní a neopakuje řádek mezi stránkami",
			firstPage.response.status === 200 &&
				typeof cursor === "string" &&
				secondPage?.response.status === 200 &&
				firstPageData?.length === 1 &&
				secondPageData?.length === 1 &&
				firstPageData[0]?.id !== secondPageData[0]?.id,
			{ firstPage: firstPage.body, secondPage: secondPage?.body },
		);

		if (typeof createdTask.id !== "string" || typeof createdTask.updatedAt !== "string") throw new Error("task response incomplete");
		result = await publicRequest(
			token,
			`/public/v1/tasks/${createdTask.id}`,
			"PATCH",
			{ expectedUpdatedAt: createdTask.updatedAt, priority: 1 },
			`patch:${crypto.randomUUID()}`,
		);
		const updatedTask = result.body.data as Record<string, unknown> | undefined;
		check("optimistický PATCH upraví jen povolený úkol", result.response.status === 200 && updatedTask?.priority === 1, result.body);
		const stale = await publicRequest(
			token,
			`/public/v1/tasks/${createdTask.id}`,
			"PATCH",
			{ expectedUpdatedAt: createdTask.updatedAt, priority: 3 },
			`stale:${crypto.randomUUID()}`,
		);
		check("zastaralý PATCH se nepřepíše přes novější změnu", stale.response.status === 409 && stale.body.error === "stale_version", stale.body);
		const invalidDates = await publicRequest(
			token,
			`/public/v1/tasks/${createdTask.id}`,
			"PATCH",
			{
				expectedUpdatedAt: updatedTask?.updatedAt,
				dueDate: "2026-08-20",
				deadline: "2026-08-19",
			},
			`dates:${crypto.randomUUID()}`,
		);
		check(
			"neplatná kombinace termínů je řízené 422, ne DB 500",
			invalidDates.response.status === 422 && invalidDates.body.error === "deadline_before_due",
			invalidDates.body,
		);

		const suppressedId = crypto.randomUUID();
		await db.transaction(async (tx) => {
			await tx.execute(sql`SELECT set_config('watson.suppress_webhook_events', 'on', true)`);
			await tx.insert(tasks).values({ id: suppressedId, projectId: allowedProject.id, name: "Restore-only task" });
		});
		const suppressedEvents = await db.select().from(webhookEvents).where(eq(webhookEvents.entityId, suppressedId));
		check("restore GUC potlačí falešné outbox události", suppressedEvents.length === 0);

		check(
			"SSRF klasifikace odmítá interní a dokumentační adresy",
			isPublicWebhookAddress("8.8.8.8") &&
				!isPublicWebhookAddress("127.0.0.1") &&
				!isPublicWebhookAddress("169.254.169.254") &&
				!isPublicWebhookAddress("192.0.2.1") &&
				!isPublicWebhookAddress("::1"),
		);

		result = await sessionRequest(cookie, `/api/developer/webhooks/${subscription.id}`, "PATCH", {
			workspaceId: workspace.id,
			expectedVersion: 1,
			active: false,
		});
		check("webhook lifecycle používá CAS verzi", result.response.status === 200 && result.body.version === 2, result.body);
		result = await sessionRequest(cookie, `/api/developer/clients/${client.id}`, "DELETE", { workspaceId: workspace.id });
		check("admin klíč zneplatní", result.response.status === 200, result.body);
		const afterRevoke = await publicRequest(token, "/public/v1/projects");
		check("revokovaný bearer okamžitě přestane fungovat", afterRevoke.response.status === 401);

		const snapshot = await sessionRequest(cookie, `/api/developer?workspaceId=${workspace.id}`);
		check(
			"control-plane snapshot nikdy znovu nevrátí token ani signing secret",
			snapshot.response.status === 200 && !snapshot.text.includes(token) && !snapshot.text.includes(signingSecret),
		);
	} finally {
		await new Promise<void>((resolve, reject) => {
			receiver.close((error) => (error ? reject(error) : resolve()));
		});
		receiver.closeAllConnections();
		await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
		await db.delete(users).where(eq(users.id, owner.id));
	}

	if (failed) throw new Error(`public API verifier: ${failed} checks failed`);
	console.log("\nPublic API + webhooks: vše prošlo");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
