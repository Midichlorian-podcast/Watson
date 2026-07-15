/**
 * Integrační test CC-P0-15 (cross-tenant reference ve write-path) — reálné API +
 * PostgreSQL, dva prostory a dvě identity. Vyžaduje běžící instanci API:
 *   API_PORT=8788 pnpm exec tsx src/index.ts   (v druhém terminálu)
 *   pnpm exec tsx verify-sync-refs.ts
 *
 * Invariant: tasks.meeting_id smí ukazovat JEN na poradu ze stejného prostoru jako
 * projekt úkolu. Bez toho jde úkolu podstrčit cizí poradu a UI z toho vykreslí
 * důvěryhodný chip „z porady" s proklikem. Neexistující cíl je odmítnut:
 * meeting + hub/action tasky vznikají atomickými command endpointy, takže zde
 * neexistuje legitimní důvod přijmout osiřelý soft-reference zápis.
 *
 * Negativní testy ověřují i NEZMĚNĚNOU DB, ne jen HTTP kód.
 */
import "./src/env";
import {
	eq,
	getDb,
	meetings,
	memberships,
	projectMembers,
	projects,
	sql,
	tasks,
	users,
	workspaces,
} from "@watson/db";

const API = process.env.RBAC_API ?? "http://127.0.0.1:8788";
const db = getDb();
let failed = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
	if (cond) console.log(`  ✓ ${label}`);
	else {
		failed++;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

/** Přihlášení identity: magic-link → token z verifications → verify → session cookie. */
async function login(email: string): Promise<string> {
	const r = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
		body: JSON.stringify({ email, callbackURL: "http://localhost:5173/" }),
	});
	if (!r.ok) throw new Error(`magic-link ${email}: ${r.status}`);
	const rows = (await db.execute(
		sql`SELECT identifier FROM verifications ORDER BY created_at DESC LIMIT 1`,
	)) as { identifier: string }[];
	const token = rows[0]?.identifier;
	const v = await fetch(
		`${API}/api/auth/magic-link/verify?token=${token}&callbackURL=http://localhost:5173/`,
		{ redirect: "manual" },
	);
	const cookie = v.headers.getSetCookie?.().join("; ") ?? v.headers.get("set-cookie") ?? "";
	const sess = cookie
		.split(/,(?=\s*\w+=)/)
		.map((s) => s.split(";")[0]?.trim())
		.filter(Boolean)
		.join("; ");
	if (!sess) throw new Error(`login ${email}: chybí session cookie`);
	const who = (await (
		await fetch(`${API}/api/auth/get-session`, {
			headers: { Cookie: sess, Origin: "http://localhost:5173" },
		})
	).json()) as { user?: { email?: string } } | null;
	if (who?.user?.email !== email)
		throw new Error(`login ${email}: session patří ${who?.user?.email ?? "nikomu"}`);
	return sess;
}

const write = (cookie: string) => {
	const clientId = `sync-refs-${crypto.randomUUID()}`;
	let operationId = 0;
	return (
		op: string,
		table: string,
		id: string,
		data: unknown,
		explicitOperationId?: string,
		previous?: Record<string, unknown>,
	) =>
		fetch(`${API}/api/sync/write`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: "http://localhost:5173",
				Cookie: cookie,
			},
			body: JSON.stringify({
				op,
				table,
				id,
				data,
				previous,
				clientId,
				operationId: explicitOperationId ?? String(++operationId),
			}),
		});
};

const meetingOf = async (taskId: string) =>
	(await db.select({ m: tasks.meetingId }).from(tasks).where(eq(tasks.id, taskId)))[0]?.m ?? null;
const taskExists = async (taskId: string) =>
	(await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId))).length > 0;
const taskName = async (taskId: string) =>
	(await db.select({ name: tasks.name }).from(tasks).where(eq(tasks.id, taskId)))[0]?.name ?? null;
const taskSnapshot = async (taskId: string) => {
	const rows = (await db.execute(sql`
		SELECT project_id, section_id, parent_id, name, description, why_now, priority, color,
		       due_date, start_date, start_timezone, deadline, duration_min, days, sort_order,
		       recurrence, recurrence_rule, recurrence_basis, assignment_mode,
		       status_id, mail_th, mail_label, kind, meeting_id, completed_at
		FROM tasks WHERE id = ${taskId} LIMIT 1
	`)) as Record<string, unknown>[];
	if (!rows[0]) throw new Error("task snapshot missing");
	return rows[0];
};
const auditCount = async (taskId: string) => {
	const rows = (await db.execute(
		sql`SELECT count(*)::int AS n FROM audit_events WHERE entity = 'tasks' AND entity_id = ${taskId}`,
	)) as { n: number }[];
	return rows[0]?.n ?? 0;
};

async function main() {
	// ── setup: DVA izolované prostory, jedna identita členem obou ──
	const [u] = await db
		.insert(users)
		.values({
			id: crypto.randomUUID(),
			name: "Refs tester",
			email: "refs-tester@watson.test",
			emailVerified: true,
		})
		.returning({ id: users.id, email: users.email });
	if (!u) throw new Error("setup user insert returned no row");
	const me = u;

	const mkWs = async (name: string) => {
		const [w] = await db
			.insert(workspaces)
			.values({ name, ownerId: me.id, isPersonal: false })
			.returning({ id: workspaces.id });
		if (!w) throw new Error("setup workspace insert returned no row");
		const wsId = w.id;
		await db.insert(memberships).values({ workspaceId: wsId, userId: me.id, role: "admin" });
		const [p] = await db
			.insert(projects)
			.values({ workspaceId: wsId, name: `${name} projekt`, ownerId: me.id })
			.returning({ id: projects.id });
		if (!p) throw new Error("setup project insert returned no row");
		const pid = p.id;
		await db.insert(projectMembers).values({ projectId: pid, userId: me.id, role: "manager" });
		const [m] = await db
			.insert(meetings)
			.values({ workspaceId: wsId, title: `${name} porada`, status: "scheduled", createdBy: me.id })
			.returning({ id: meetings.id });
		if (!m) throw new Error("setup meeting insert returned no row");
		return { wsId, pid, meetingId: m.id };
	};
	const A = await mkWs("Refs A");
	const B = await mkWs("Refs B");

	try {
		const w = write(await login(me.email));
		const mkTask = (_id: string, pid: string, meetingId: string | null) => ({
			project_id: pid,
			name: "Refs úkol",
			priority: 3,
			assignment_mode: "single",
			meeting_id: meetingId,
			created_at: new Date().toISOString(),
		});

		// 1) porada VLASTNÍHO prostoru → projde
		const t1 = crypto.randomUUID();
		let r = await w("PUT", "tasks", t1, mkTask(t1, A.pid, A.meetingId));
		check("úkol s poradou vlastního prostoru projde (200)", r.status === 200, r.status);
		check("  …a meeting_id je uložené", (await meetingOf(t1)) === A.meetingId);

		// 2) porada CIZÍHO prostoru → 403 a řádek nesmí vzniknout
		const t2 = crypto.randomUUID();
		r = await w("PUT", "tasks", t2, mkTask(t2, A.pid, B.meetingId));
		check("úkol s poradou CIZÍHO prostoru odmítnut (403)", r.status === 403, r.status);
		check("  …a řádek v DB nevznikl", !(await taskExists(t2)));

		// 3) PATCH existujícího úkolu na cizí poradu → 403, DB beze změny
		r = await w(
			"PATCH",
			"tasks",
			t1,
			{ meeting_id: B.meetingId },
			undefined,
			await taskSnapshot(t1),
		);
		check("PATCH na poradu cizího prostoru odmítnut (403)", r.status === 403, r.status);
		check("  …a meeting_id zůstal původní", (await meetingOf(t1)) === A.meetingId);

		// 4) neexistující porada → 422 a žádný osiřelý task/chip
		const t4 = crypto.randomUUID();
		const ghost = crypto.randomUUID();
		r = await w("PUT", "tasks", t4, mkTask(t4, A.pid, ghost));
		check("neexistující porada je odmítnuta (422)", r.status === 422, r.status);
		check("  …a osiřelý task v DB nevznikl", !(await taskExists(t4)));

		// 5) nesmysl místo UUID → deterministicky 422 (ne 500, ne uložený chip)
		const t5 = crypto.randomUUID();
		r = await w("PUT", "tasks", t5, mkTask(t5, A.pid, "úplný-nesmysl"));
		check("nesmysl místo UUID skončí 422 (ne 500)", r.status === 422, r.status);
		check("  …a řádek v DB nevznikl", !(await taskExists(t5)));

		// 6) úkol BEZ porady se nezmění (regrese: kontrola nesmí blokovat běžný zápis)
		const t6 = crypto.randomUUID();
		r = await w("PUT", "tasks", t6, mkTask(t6, A.pid, null));
		check("běžný úkol bez porady projde (200)", r.status === 200, r.status);

		// 6b) produktový limit „Proč teď?“ musí být stejný na API i v DB.
		const tooLongWhyNow = crypto.randomUUID();
		r = await w("PUT", "tasks", tooLongWhyNow, {
			...mkTask(tooLongWhyNow, A.pid, null),
			why_now: "x".repeat(1001),
		});
		check("why_now nad 1 000 znaků API odmítne (422)", r.status === 422, r.status);
		check("  …a neplatný úkol v DB nevznikl", !(await taskExists(tooLongWhyNow)));
		const validWhyNow = crypto.randomUUID();
		r = await w("PUT", "tasks", validWhyNow, {
			...mkTask(validWhyNow, A.pid, null),
			why_now: "x".repeat(1000),
		});
		check("why_now přesně 1 000 znaků projde (200)", r.status === 200, r.status);

		// 7) stejná operace po timeoutu je idempotentní, nový CREATE stejného id je konflikt.
		const t7 = crypto.randomUUID();
		const original = mkTask(t7, A.pid, null);
		r = await w("PUT", "tasks", t7, original, "idempotent-create");
		check("první CREATE projde (200)", r.status === 200, r.status);
		r = await w("PUT", "tasks", t7, original, "idempotent-create");
		check("retry stejné operace projde jako replay (200)", r.status === 200, r.status);
		check("retry nevytvoří druhý audit event", (await auditCount(t7)) === 1, await auditCount(t7));

		r = await w("PUT", "tasks", t7, { ...original, name: "Podvržený retry" }, "idempotent-create");
		const reused = (await r.json()) as { code?: string };
		check(
			"stejný idempotency klíč s jiným payloadem je 409",
			r.status === 409 && reused.code === "idempotency_key_reused",
			{ status: r.status, reused },
		);
		check("podvržený retry nezmění data", (await taskName(t7)) === "Refs úkol", await taskName(t7));

		r = await w("PUT", "tasks", t7, { ...original, name: "Nový CREATE" }, "second-create");
		const conflict = (await r.json()) as { code?: string };
		check(
			"nový CREATE existujícího id je 409 create_conflict",
			r.status === 409 && conflict.code === "create_conflict",
			{ status: r.status, conflict },
		);
		check(
			"CREATE konflikt nepřepíše původní řádek",
			(await taskName(t7)) === "Refs úkol",
			await taskName(t7),
		);

		// 8) PATCH/DELETE jsou compare-and-swap proti snapshotu z editovaného zařízení.
		const oldSnapshot = await taskSnapshot(t7);
		r = await w("PATCH", "tasks", t7, { name: "Současná změna" }, undefined, oldSnapshot);
		check("PATCH s aktuálním snapshotem projde (200)", r.status === 200, r.status);
		r = await w("PATCH", "tasks", t7, { priority: 4 }, undefined, oldSnapshot);
		const stale = (await r.json()) as { code?: string };
		check(
			"PATCH ze stale snapshotu je 409 stale_write",
			r.status === 409 && stale.code === "stale_write",
			{ status: r.status, stale },
		);
		check("stale PATCH nepřepíše novější data", (await taskName(t7)) === "Současná změna");
		r = await w("PATCH", "tasks", t7, { priority: 4 }, undefined, await taskSnapshot(t7));
		check("PATCH po načtení čerstvého snapshotu projde", r.status === 200, r.status);
	} finally {
		// ── cleanup: workspace kaskáduje projekty/úkoly/porady; pak uživatel ──
		await db.delete(workspaces).where(eq(workspaces.id, A.wsId));
		await db.delete(workspaces).where(eq(workspaces.id, B.wsId));
		await db.delete(users).where(eq(users.id, me.id));
	}

	if (failed) {
		console.error(`\nSync refs integrace: ${failed} SELHALO`);
		process.exit(1);
	}
	console.log("\nSync refs integrace: vše prošlo");
	process.exit(0);
}

main().catch(async (e) => {
	console.error(e);
	process.exit(1);
});
