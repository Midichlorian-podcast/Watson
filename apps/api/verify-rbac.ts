/**
 * Integrační test CC-P0-05 (RBAC členství) — dvě a více reálných identit proti
 * běžícímu API a PostgreSQL. Vyžaduje instanci API (default http://127.0.0.1:8788):
 *   API_PORT=8788 pnpm exec tsx src/index.ts   (v druhém terminálu)
 *   pnpm exec tsx verify-rbac.ts
 *
 * Matice (rozhodnutí §15/5): členství projektu smí měnit jen project manager
 * nebo workspace admin/owner; změna ws role vyžaduje hodnost VYŠŠÍ než má cíl;
 * poslední admin a poslední project manager jsou chránění.
 *
 * Skript si vyrobí vlastní workspace + uživatele, po doběhu vše smaže.
 * Negativní testy ověřují i NEZMĚNĚNOU DB, ne jen HTTP kód.
 */
import "./src/env";
import {
	and,
	eq,
	getDb,
	memberships,
	projectMembers,
	projects,
	sql,
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

/** Přihlášení identit: magic-link → token z verifications → verify → session cookie. */
async function login(email: string): Promise<string> {
	const r = await fetch(`${API}/api/auth/sign-in/magic-link`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
		body: JSON.stringify({ email, callbackURL: "http://localhost:5173/" }),
	});
	if (!r.ok) throw new Error(`magic-link ${email}: ${r.status}`);
	const rows = (await db.execute(
		// verifications drží token v identifier; nejnovější pro daný běh
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
		.map((s) => s.split(";")[0]!.trim())
		.filter(Boolean)
		.join("; ");
	if (!sess) throw new Error(`login ${email}: chybí session cookie`);
	// pojistka proti pomíchaným tokenům: session musí patřit té identitě, kterou čekáme
	const who = (await (
		await fetch(`${API}/api/auth/get-session`, {
			headers: { Cookie: sess, Origin: "http://localhost:5173" },
		})
	).json()) as { user?: { email?: string } } | null;
	if (who?.user?.email !== email)
		throw new Error(`login ${email}: session patří ${who?.user?.email ?? "nikomu"}`);
	return sess;
}

const api = (cookie: string) => ({
	post: (path: string, body: unknown) =>
		fetch(`${API}${path}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: "http://localhost:5173",
				Cookie: cookie,
			},
			body: JSON.stringify(body),
		}),
	patch: (path: string, body: unknown) =>
		fetch(`${API}${path}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Origin: "http://localhost:5173",
				Cookie: cookie,
			},
			body: JSON.stringify(body),
		}),
	del: (path: string) =>
		fetch(`${API}${path}`, {
			method: "DELETE",
			headers: { Origin: "http://localhost:5173", Cookie: cookie },
		}),
});

async function main() {
	// ── setup: vlastní izolovaný svět ──
	const mkUser = async (slug: string) => {
		const [u] = await db
			.insert(users)
			.values({
				id: crypto.randomUUID(),
				name: `RBAC ${slug}`,
				email: `rbac-${slug}@watson.test`,
				emailVerified: true,
			})
			.returning({ id: users.id, email: users.email });
		return u!;
	};
	const OW = await mkUser("owner");
	const AD = await mkUser("admin");
	const AD2 = await mkUser("admin2");
	const MG = await mkUser("manager");
	const ME = await mkUser("member");
	const PM = await mkUser("pmgr");
	const ED = await mkUser("editor");

	const [ws] = await db
		.insert(workspaces)
		.values({ name: "RBAC test ws", ownerId: OW.id, isPersonal: false })
		.returning({ id: workspaces.id });
	const wsId = ws!.id;
	await db.insert(memberships).values([
		// OW je owner přes workspaces.owner_id; membership má schválně jen "member",
		// aby šel postavit scénář „poslední admin" (owner sám je nedegradovatelný).
		{ workspaceId: wsId, userId: OW.id, role: "member" },
		{ workspaceId: wsId, userId: AD.id, role: "admin" },
		{ workspaceId: wsId, userId: AD2.id, role: "admin" },
		{ workspaceId: wsId, userId: MG.id, role: "manager" },
		{ workspaceId: wsId, userId: ME.id, role: "member" },
		{ workspaceId: wsId, userId: PM.id, role: "member" },
		{ workspaceId: wsId, userId: ED.id, role: "member" },
	]);
	const [proj] = await db
		.insert(projects)
		.values({ workspaceId: wsId, name: "RBAC projekt", ownerId: OW.id })
		.returning({ id: projects.id });
	const pid = proj!.id;
	await db.insert(projectMembers).values([
		{ projectId: pid, userId: PM.id, role: "manager" },
		{ projectId: pid, userId: ED.id, role: "editor" },
	]);

	const isPM = async (uid: string) =>
		(
			await db
				.select({ id: projectMembers.id })
				.from(projectMembers)
				.where(and(eq(projectMembers.projectId, pid), eq(projectMembers.userId, uid)))
		).length > 0;
	const wsRole = async (uid: string) =>
		(
			await db
				.select({ role: memberships.role })
				.from(memberships)
				.where(and(eq(memberships.workspaceId, wsId), eq(memberships.userId, uid)))
		)[0]?.role;

	try {
		const [ed, pm, ad, mg, ow] = [
			api(await login(ED.email)),
			api(await login(PM.email)),
			api(await login(AD.email)),
			api(await login(MG.email)),
			api(await login(OW.email)),
		];

		// ── členství projektu ──
		let r = await ed.post(`/api/projects/${pid}/members`, { userId: ME.id });
		check("editor NEsmí přidat člena projektu (403)", r.status === 403, r.status);
		check("  …a DB je nezměněná", !(await isPM(ME.id)));

		r = await ed.del(`/api/projects/${pid}/members/${PM.id}`);
		check("editor NEsmí odebrat člena projektu (403)", r.status === 403, r.status);
		check("  …a manager v projektu zůstal", await isPM(PM.id));

		r = await mg.post(`/api/projects/${pid}/members`, { userId: ME.id });
		check("ws manager (mimo projekt) NEsmí přidávat (403)", r.status === 403, r.status);

		r = await pm.post(`/api/projects/${pid}/members`, { userId: ME.id });
		check("project manager SMÍ přidat člena (200)", r.status === 200, r.status);
		check("  …a člen přibyl", await isPM(ME.id));

		r = await ad.del(`/api/projects/${pid}/members/${ME.id}`);
		check("ws admin SMÍ odebrat člena (200)", r.status === 200, r.status);
		check("  …a člen zmizel", !(await isPM(ME.id)));

		r = await ad.del(`/api/projects/${pid}/members/${PM.id}`);
		check("posledního project managera NELZE odebrat (409)", r.status === 409, r.status);
		check("  …a v projektu zůstal", await isPM(PM.id));

		// ── změna workspace role ──
		r = await mg.patch(`/api/workspaces/${wsId}/members/${AD.id}/role`, { role: "member" });
		check("manager NEsmí degradovat admina (403)", r.status === 403, r.status);
		check("  …a admin zůstal adminem", (await wsRole(AD.id)) === "admin");

		r = await ad.patch(`/api/workspaces/${wsId}/members/${AD2.id}/role`, { role: "member" });
		check("admin NEsmí měnit jiného admina (403)", r.status === 403, r.status);

		r = await ad.patch(`/api/workspaces/${wsId}/members/${MG.id}/role`, { role: "member" });
		check("admin SMÍ degradovat managera (200)", r.status === 200, r.status);
		check("  …a role se změnila", (await wsRole(MG.id)) === "member");

		r = await ow.patch(`/api/workspaces/${wsId}/members/${AD2.id}/role`, { role: "member" });
		check("owner SMÍ degradovat admina (200)", r.status === 200, r.status);
		r = await ow.patch(`/api/workspaces/${wsId}/members/${AD.id}/role`, { role: "member" });
		check("POSLEDNÍHO admina nelze degradovat (409)", r.status === 409, r.status);
		check("  …a zůstal adminem", (await wsRole(AD.id)) === "admin");
	} finally {
		// ── cleanup: workspace kaskáduje projekty/členství; pak uživatelé ──
		await db.delete(workspaces).where(eq(workspaces.id, wsId));
		for (const u of [OW, AD, AD2, MG, ME, PM, ED])
			await db.delete(users).where(eq(users.id, u.id));
	}

	if (failed) {
		console.error(`\nRBAC integrace: ${failed} SELHALO`);
		process.exit(1);
	}
	console.log("\nRBAC integrace: vše prošlo");
	process.exit(0);
}

main().catch(async (e) => {
	console.error(e);
	process.exit(1);
});
