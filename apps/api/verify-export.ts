/**
 * Verifikace CC-P0-14 slice: serverový export. Vyžaduje běžící API (default
 * http://127.0.0.1:8787) a PostgreSQL. Kontroluje:
 *  1. checksum manifestu odpovídá obsahu (poškozený soubor jde poznat),
 *  2. počty řádků sedí na přímé DB dotazy pro stejný ACL scope,
 *  3. meetings NEobsahují transcript/extraction (privacy default §15/3).
 * Spuštění: pnpm --filter @watson/api verify:export
 */
import "./src/env";
import { createHash } from "node:crypto";
import { getDb, sql } from "@watson/db";

const API = process.env.EXPORT_API ?? "http://127.0.0.1:8787";
const db = getDb();
let failed = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		failed++;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

async function login(email: string): Promise<string> {
	const r = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
		body: JSON.stringify({ email, callbackURL: "http://localhost:5173/" }),
	});
	if (!r.ok) throw new Error(`magic-link: ${r.status}`);
	const rows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as { identifier: string }[];
	const v = await fetch(
		`${API}/api/auth/magic-link/verify?token=${rows[0]?.identifier}&callbackURL=http://localhost:5173/`,
		{ redirect: "manual" },
	);
	const cookie = (v.headers.getSetCookie?.() ?? []).map((s) => s.split(";")[0]).join("; ");
	if (!cookie) throw new Error("chybí session cookie");
	return cookie;
}

async function main() {
	const cookie = await login("demo@watson.test");
	const r = await fetch(`${API}/api/export`, {
		headers: { Cookie: cookie, Origin: "http://localhost:5173" },
	});
	check("export endpoint 200", r.status === 200, r.status);
	const body = (await r.json()) as {
		manifest: { checksum: string; counts: Record<string, number>; schemaMigrations: number };
		tables: Record<string, Record<string, unknown>[]>;
	};

	// 1) checksum
	const recomputed = createHash("sha256").update(JSON.stringify(body.tables)).digest("hex");
	check("checksum sedí na obsah", recomputed === body.manifest.checksum);

	// 2) počty vs. přímé DB dotazy (stejný scope: non-guest workspaces demo účtu)
	const userId = (
		(await db.execute(
			sql`SELECT id FROM users WHERE email = 'demo@watson.test'`,
		)) as { id: string }[]
	)[0]?.id as string;
	const ws = (
		(await db.execute(
			sql`SELECT workspace_id FROM memberships WHERE user_id = ${userId} AND role <> 'guest'`,
		)) as { workspace_id: string }[]
	).map((x) => x.workspace_id);
	const direct = async (q: ReturnType<typeof sql>) =>
		Number(((await db.execute(q)) as { n: number }[])[0]?.n);
	const expectTasks = await direct(
		sql`SELECT count(*)::int AS n FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.workspace_id = ANY(ARRAY[${sql.join(ws.map((w) => sql`${w}`), sql`, `)}]::uuid[])`,
	);
	check("tasks count sedí", body.manifest.counts.tasks === expectTasks, {
		manifest: body.manifest.counts.tasks,
		db: expectTasks,
	});
	const expectAudit = await direct(
		sql`SELECT count(*)::int AS n FROM workspaces WHERE id = ANY(ARRAY[${sql.join(ws.map((w) => sql`${w}`), sql`, `)}]::uuid[])`,
	);
	check("workspaces count sedí", body.manifest.counts.workspaces === expectAudit, {
		manifest: body.manifest.counts.workspaces,
		db: expectAudit,
	});
	check("manifest zná verzi schématu", (body.manifest.schemaMigrations ?? 0) > 0);

	// 3) privacy: meetings bez obsahu
	const anyMeeting = body.tables.meetings?.[0];
	check(
		"meetings bez transcript/extraction",
		!anyMeeting || (!("transcript" in anyMeeting) && !("extraction" in anyMeeting)),
		anyMeeting ? Object.keys(anyMeeting) : "žádný meeting",
	);

	if (failed) {
		console.error(`\nExport verify: ${failed} SELHALO`);
		process.exit(1);
	}
	console.log("\nExport verify: vše prošlo");
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
