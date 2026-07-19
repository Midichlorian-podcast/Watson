import "./src/env";
import { getDb, sql } from "@watson/db";

const API = process.env.VALIDATION_API ?? "http://127.0.0.1:8787";
const ORIGIN = "http://localhost:5173";
const db = getDb();
let failed = 0;

type SloSnapshot = {
	ok?: boolean;
	database?: string;
	reminderDead?: number | null;
	counters?: {
		http5xxTotal?: number;
		authFailureTotal?: number;
		syncRejectionTotal?: number;
		providerTimeoutTotal?: number;
	};
};

function check(label: string, condition: boolean, detail?: unknown) {
	if (condition) console.log(`✓ ${label}`);
	else {
		failed++;
		console.error(`✗ ${label}: ${JSON.stringify(detail)}`);
	}
}

async function login(email: string) {
	await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: ORIGIN },
		body: JSON.stringify({ email, callbackURL: `${ORIGIN}/` }),
	});
	const token = (
		(await db.execute(sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`)) as {
			identifier: string;
		}[]
	)[0]?.identifier;
	const response = await fetch(
		`${API}/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(`${ORIGIN}/`)}`,
		{ redirect: "manual" },
	);
	const cookie = (response.headers.getSetCookie?.() ?? [])
		.map((value) => value.split(";")[0])
		.join("; ");
	if (!cookie) throw new Error("login_failed");
	return cookie;
}

async function post(path: string, cookie: string, body: unknown) {
	return fetch(`${API}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
		body: JSON.stringify(body),
	});
}

async function readSlo(token: string) {
	const response = await fetch(`${API}/ops/slo`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	return { response, body: (await response.json()) as SloSnapshot };
}

async function main() {
	const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const userId = crypto.randomUUID();
	const workspaceId = crypto.randomUUID();
	const email = `validation-${suffix}@watson.test`;
	await db.execute(sql`INSERT INTO users (id, name, email, email_verified) VALUES (${userId}, 'Validation', ${email}, true)`);
	await db.execute(sql`INSERT INTO workspaces (id, name, owner_id) VALUES (${workspaceId}, 'Validation', ${userId})`);
	await db.execute(sql`INSERT INTO memberships (user_id, workspace_id, role) VALUES (${userId}, ${workspaceId}, 'admin')`);

	try {
		const opsToken = process.env.OPS_METRICS_TOKEN;
		if (!opsToken) throw new Error("OPS_METRICS_TOKEN missing in observability verification");
		let response = await fetch(`${API}/ops/slo`);
		check("SLO endpoint je fail-closed bez bearer tokenu", response.status === 401, response.status);
		const beforeSlo = await readSlo(opsToken);
		check(
			"autorizovaný SLO snapshot ověřuje databázi",
			beforeSlo.response.status === 200 &&
				beforeSlo.body.ok === true &&
				beforeSlo.body.database === "up" &&
				typeof beforeSlo.body.reminderDead === "number",
			beforeSlo.body,
		);

		response = await fetch(`${API}/api/auth/sign-in/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: ORIGIN },
			body: JSON.stringify({ email: `missing-${suffix}@watson.test`, password: "wrong-password" }),
		});
		check("neúspěšné přihlášení vrací řízenou 4xx", response.status >= 400 && response.status < 500, response.status);

		response = await fetch(`${API}/api/me/local-data-key`);
		check("lokální šifrovací klíč vyžaduje session", response.status === 401, response.status);

		response = await fetch(`${API}/api/employee/me`);
		check(
			"employee middleware bez session vrací řízené 401 místo 500",
			response.status === 401,
			response.status,
		);

		const cookie = await login(email);
		response = await post("/api/sync/write", cookie, {});
		check("neplatný sync envelope je trvalé odmítnutí", response.status === 422, response.status);

		response = await fetch(`${API}/api/me/local-data-key`, {
			headers: { Origin: ORIGIN, Cookie: cookie },
		});
		const localKey1 = (await response.json()) as { key?: string; version?: number };
		const keyResponse2 = await fetch(`${API}/api/me/local-data-key`, {
			headers: { Origin: ORIGIN, Cookie: cookie },
		});
		const localKey2 = (await keyResponse2.json()) as { key?: string; version?: number };
		check(
			"per-user lokální klíč je stabilní, verzovaný a silný",
			response.status === 200 &&
				localKey1.version === 1 &&
				(localKey1.key?.length ?? 0) >= 43 &&
				localKey1.key === localKey2.key,
			{ status: response.status, version: localKey1.version, length: localKey1.key?.length },
		);
		check(
			"odpověď se šifrovacím klíčem se nikdy necachuje",
			response.headers.get("cache-control")?.includes("no-store") === true,
		);

		response = await post("/api/projects", cookie, {
			name: "Strict project",
			workspaceId,
			unexpected: true,
		});
		check("project create odmítá neznámá pole", response.status === 422, response.status);

		response = await post("/api/projects", cookie, {
			name: "Bad color",
			workspaceId,
			color: "javascript:alert(1)",
		});
		check("project create validuje barvu za běhu", response.status === 422, response.status);

		response = await fetch(`${API}/api/workspaces/${workspaceId}/members/${userId}/profile`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
			body: JSON.stringify({ areas: "ok", extra: "must fail" }),
		});
		check("member profile je strict schema", response.status === 422, response.status);

		response = await post(`/api/workspaces/${workspaceId}/invite`, cookie, {
			email: "not-an-email",
			role: "root",
		});
		check("invite validuje e-mail i roli", response.status === 422, response.status);

		response = await post("/api/projects/not-a-uuid/members", cookie, { userId: "also-bad" });
		check("project member endpoint odmítá neplatná UUID", response.status === 422, response.status);

		response = await post("/api/push/subscribe", cookie, {
			endpoint: "http://127.0.0.1/internal",
			keys: { p256dh: "a".repeat(65), auth: "b".repeat(16) },
		});
		check("push endpoint musí být veřejné HTTPS", response.status === 422, response.status);

		response = await fetch(`${API}/api/me`, {
			headers: { Origin: ORIGIN, Cookie: cookie },
		});
		check("citlivé API odpovědi mají no-store", response.headers.get("cache-control")?.includes("no-store") === true);
		check("odpověď nese request ID", /^[0-9a-f-]{8,}$/i.test(response.headers.get("x-request-id") ?? ""));
		check("odpověď nese server timing", /^app;dur=/.test(response.headers.get("server-timing") ?? ""));

		response = await fetch(`${API}/health/ready`);
		const health = (await response.json()) as { ok?: boolean; database?: string };
		check("readiness skutečně kontroluje databázi", response.status === 200 && health.ok === true && health.database === "up", health);

		const afterSlo = await readSlo(opsToken);
		check(
			"SLO čítač zachytí auth failure",
			(afterSlo.body.counters?.authFailureTotal ?? 0) >=
				(beforeSlo.body.counters?.authFailureTotal ?? 0) + 1,
			afterSlo.body.counters,
		);
		check(
			"SLO čítač zachytí trvalé sync odmítnutí",
			(afterSlo.body.counters?.syncRejectionTotal ?? 0) >=
				(beforeSlo.body.counters?.syncRejectionTotal ?? 0) + 1,
			afterSlo.body.counters,
		);
	} finally {
		await db.execute(sql`DELETE FROM workspaces WHERE id = ${workspaceId}`);
		await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
	}

	if (failed) process.exit(1);
	console.log("Input and observability verification passed.");
	process.exit(0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
