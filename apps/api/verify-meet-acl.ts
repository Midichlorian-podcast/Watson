/**
 * Integrační test CC-P0-13 / rozhodnutí §15/3 — OBSAH porady (přepis, AI extraction)
 * vidí jen ÚČASTNÍK. Reálné API + PostgreSQL, pět identit. Vyžaduje běžící API:
 *   API_PORT=8788 pnpm exec tsx src/index.ts   (v druhém terminálu)
 *   pnpm exec tsx verify-meet-acl.ts
 *
 * Matice: účastník / pozvaný (= přidaný mezi účastníky) / řadový člen prostoru /
 * ADMIN bez pozvání / host. Admin NENÍ automatický čtenář obsahu.
 * Ověřuje se čtení i všechny zápisové cesty (extract = platí se AI, uložení
 * zápisu, autosave revize, commit) a že po odebrání z účastníků přístup končí.
 */
import "./src/env";
import {
	assignments,
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
	const v = await fetch(
		`${API}/api/auth/magic-link/verify?token=${rows[0]?.identifier}&callbackURL=http://localhost:5173/`,
		{ redirect: "manual" },
	);
	const cookie = v.headers.getSetCookie?.().join("; ") ?? v.headers.get("set-cookie") ?? "";
	const sess = cookie
		.split(/,(?=\s*\w+=)/)
		.map((s) => s.split(";")[0]?.trim() ?? "")
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

const api = (cookie: string) => ({
	get: (path: string) =>
		fetch(`${API}${path}`, { headers: { Origin: "http://localhost:5173", Cookie: cookie } }),
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
});

const TRANSCRIPT = "Porada: Adéla objedná židle do čtvrtka. Tomáš pošle ceník do pondělí.";

async function main() {
	const mkUser = async (slug: string) => {
		const [u] = await db
			.insert(users)
			.values({
				id: crypto.randomUUID(),
				name: `ACL ${slug}`,
				email: `acl-${slug}-${Date.now()}@watson.test`,
				emailVerified: true,
			})
			.returning({ id: users.id, email: users.email });
		if (!u) throw new Error(`fixture_user_missing:${slug}`);
		return u;
	};
	const OW = await mkUser("owner"); // zakladatel porady = účastník
	const PART = await mkUser("part"); // přiřazený na kotevním úkolu
	const INV = await mkUser("invited"); // přidaný mezi účastníky až později
	const MEM = await mkUser("member"); // řadový člen prostoru, na poradě nebyl
	const ADM = await mkUser("admin"); // admin prostoru BEZ pozvání
	const GST = await mkUser("guest"); // host

	const [ws] = await db
		.insert(workspaces)
		.values({ name: "ACL test ws", ownerId: OW.id, isPersonal: false })
		.returning({ id: workspaces.id });
	if (!ws) throw new Error("fixture_workspace_missing");
	const wsId = ws.id;
	await db.insert(memberships).values([
		{ workspaceId: wsId, userId: OW.id, role: "member" },
		{ workspaceId: wsId, userId: PART.id, role: "member" },
		{ workspaceId: wsId, userId: INV.id, role: "member" },
		{ workspaceId: wsId, userId: MEM.id, role: "member" },
		{ workspaceId: wsId, userId: ADM.id, role: "admin" },
		{ workspaceId: wsId, userId: GST.id, role: "guest" },
	]);
	const [proj] = await db
		.insert(projects)
		.values({ workspaceId: wsId, name: "ACL projekt", ownerId: OW.id })
		.returning({ id: projects.id });
	if (!proj) throw new Error("fixture_project_missing");
	const pid = proj.id;
	await db.insert(projectMembers).values([
		{ projectId: pid, userId: OW.id, role: "manager" },
		{ projectId: pid, userId: PART.id, role: "editor" },
		{ projectId: pid, userId: INV.id, role: "editor" },
		{ projectId: pid, userId: MEM.id, role: "editor" },
		{ projectId: pid, userId: ADM.id, role: "editor" },
	]);
	// Porada = kotevní úkol + sidecar; účastníci = assignments hubu.
	const mid = crypto.randomUUID();
	const hubId = crypto.randomUUID();
	await db.transaction(async (tx) => {
		await tx.insert(tasks).values({
			id: hubId,
			projectId: pid,
			name: "ACL porada",
			priority: 4,
			assignmentMode: "single",
			kind: "meeting",
			meetingId: mid,
			createdBy: OW.id,
		});
		await tx.insert(meetings).values({
			id: mid,
			workspaceId: wsId,
			title: "ACL porada",
			status: "scheduled",
			hubTaskId: hubId,
			transcript: TRANSCRIPT,
			createdBy: OW.id,
		});
	});
	await db.insert(assignments).values([
		{ taskId: hubId, projectId: pid, userId: PART.id, createdAt: new Date() },
		{ taskId: hubId, projectId: pid, userId: OW.id, createdAt: new Date() },
	]);

	try {
		const [ow, part, inv, mem, adm, gst] = [
			api(await login(OW.email)),
			api(await login(PART.email)),
			api(await login(INV.email)),
			api(await login(MEM.email)),
			api(await login(ADM.email)),
			api(await login(GST.email)),
		];
		const detail = `/api/meetings/${mid}`;
		const currentBase = async () =>
			(
				await db
					.select({ updatedAt: meetings.updatedAt })
					.from(meetings)
					.where(eq(meetings.id, mid))
			)[0]?.updatedAt.toISOString();
		const bodyOf = async (r: Response) =>
			(await r.json().catch(() => ({}))) as { meeting?: unknown };

		// ── čtení obsahu ──
		let r = await part.get(detail);
		check("účastník přepis dostane (200)", r.status === 200, r.status);
		check("  …a je to skutečný text", (await r.json()).meeting?.transcript === TRANSCRIPT);
		r = await ow.get(detail);
		check("zakladatel, který na poradě je, přepis dostane (200)", r.status === 200, r.status);

		r = await mem.get(detail);
		check("řadový člen prostoru přepis NEDOSTANE (403)", r.status === 403, r.status);
		check("  …a tělo neobsahuje přepis", !(await bodyOf(r)).meeting);
		r = await adm.get(detail);
		check("ADMIN bez pozvání přepis NEDOSTANE (403 — §15/3)", r.status === 403, r.status);
		r = await gst.get(detail);
		check("host přepis NEDOSTANE (403)", r.status === 403, r.status);
		r = await inv.get(detail);
		check("nepozvaný člen přepis NEDOSTANE (403)", r.status === 403, r.status);

		// ── zápisové cesty neúčastníka (extract platí AI!) ──
		r = await mem.post("/api/meetings/extract", {
			meetingId: mid,
			transcript: TRANSCRIPT,
			vendorConsent: true,
			baseUpdatedAt: await currentBase(),
		});
		check("neúčastník NESMÍ spustit extrakci (403)", r.status === 403, r.status);
		r = await adm.post("/api/meetings/extract", {
			meetingId: mid,
			transcript: TRANSCRIPT,
			vendorConsent: true,
			baseUpdatedAt: await currentBase(),
		});
		check("admin bez pozvání NESMÍ spustit extrakci (403)", r.status === 403, r.status);
		r = await mem.post(`${detail}/transcript`, {
			transcript: "podvržený zápis",
			baseUpdatedAt: await currentBase(),
		});
		check("neúčastník NESMÍ uložit zápis (403)", r.status === 403, r.status);
		const stored = async () =>
			(await db.select({ t: meetings.transcript }).from(meetings).where(eq(meetings.id, mid)))[0]
				?.t;
		check("  …a přepis v DB zůstal původní", (await stored()) === TRANSCRIPT);
		r = await mem.post(`${detail}/extraction`, {
			proposals: [],
			baseUpdatedAt: await currentBase(),
		});
		check("neúčastník NESMÍ uložit revizi (403)", r.status === 403, r.status);
		r = await mem.post(`${detail}/commit`, { defaultProjectId: pid, proposals: [] });
		check("neúčastník NESMÍ commitnout poradu (403)", r.status === 403, r.status);
		const st = async () =>
			(await db.select({ s: meetings.status }).from(meetings).where(eq(meetings.id, mid)))[0]?.s;
		check("  …a porada zůstala nezpracovaná", (await st()) === "scheduled");

		// ── pozvání = přidání mezi účastníky ──
		await db
			.insert(assignments)
			.values({ taskId: hubId, projectId: pid, userId: INV.id, createdAt: new Date() });
		r = await inv.get(detail);
		check("po přidání mezi účastníky přepis dostane (200)", r.status === 200, r.status);
		r = await inv.post(`${detail}/transcript`, {
			transcript: TRANSCRIPT,
			baseUpdatedAt: await currentBase(),
		});
		check("  …a smí uložit zápis (200)", r.status === 200, r.status);
		const sharedBase = await currentBase();
		const concurrentSaves = await Promise.all([
			part.post(`${detail}/transcript`, {
				transcript: `${TRANSCRIPT} Varianta A.`,
				baseUpdatedAt: sharedBase,
			}),
			ow.post(`${detail}/transcript`, {
				transcript: `${TRANSCRIPT} Varianta B.`,
				baseUpdatedAt: sharedBase,
			}),
		]);
		check(
			"dva souběžné zápisy se stejnou base: právě jeden uspěje a druhý dostane 409",
			concurrentSaves.filter((save) => save.status === 200).length === 1 &&
				concurrentSaves.filter((save) => save.status === 409).length === 1,
			concurrentSaves.map((save) => save.status),
		);

		// ── odebrání účastníka přístup ukončí ──
		await db.delete(assignments).where(eq(assignments.userId, INV.id));
		r = await inv.get(detail);
		check("po odebrání z účastníků přístup končí (403)", r.status === 403, r.status);

		// ── F1: SEBEPOZVÁNÍ přes assignment na kotevním úkolu ──
		// Účastnictví = assignment; bez guardu by si ho editor projektu přidal sám
		// a odemkl si tím doslovný přepis. „Pozvání" musí být akt účastníka.
		const asgWrite = (cookie: string, id: string, userId: string) =>
			fetch(`${API}/api/sync/write`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: "http://localhost:5173",
					Cookie: cookie,
				},
				body: JSON.stringify({
					op: "PUT",
					table: "assignments",
					id,
					data: { task_id: hubId, project_id: pid, user_id: userId },
					clientId: `acl-${id.slice(0, 8)}`,
					operationId: "1",
				}),
			});
		const memCookie = await login(MEM.email);
		const selfId = crypto.randomUUID();
		r = await asgWrite(memCookie, selfId, MEM.id);
		check("editor projektu se NEMŮŽE sám přidat mezi účastníky (403)", r.status === 403, r.status);
		r = await mem.get(detail);
		check("  …a přepis dál nedostane (403)", r.status === 403, r.status);
		check(
			"  …a assignment v DB nevznikl",
			(await db.select({ id: assignments.id }).from(assignments).where(eq(assignments.id, selfId)))
				.length === 0,
		);
		// Účastník naopak pozvat SMÍ (to je „explicitně pozvaný" dle §15/3).
		const partCookie = await login(PART.email);
		const invId = crypto.randomUUID();
		r = await asgWrite(partCookie, invId, MEM.id);
		check("účastník SMÍ pozvat dalšího (200)", r.status === 200, r.status);
		r = await mem.get(detail);
		check("  …a pozvaný pak přepis dostane (200)", r.status === 200, r.status);

		// ── F2: zakladatel NENÍ trvalý čtenář — kdo naplánuje cizí 1:1 a sám na ně
		// nejde, přepis číst nesmí (jinak by šlo §15/3 obejít přes created_by).
		await db.delete(assignments).where(eq(assignments.userId, OW.id));
		r = await ow.get(detail);
		check(
			"zakladatel BEZ účasti přepis nedostane, když účastníci existují (403)",
			r.status === 403,
			r.status,
		);

		// ── porada, kterou zatím nikdo nemá přiřazenou (čerstvě naplánovaná — assignments
		// se teprve nahrávají, nebo rychlý zápis): zakladatel ano, cizí ne ──
		const mid2 = crypto.randomUUID();
		const hub2Id = crypto.randomUUID();
		await db.transaction(async (tx) => {
			await tx.insert(tasks).values({
				id: hub2Id,
				projectId: pid,
				name: "ACL porada bez účastníků",
				priority: 4,
				assignmentMode: "single",
				kind: "meeting",
				meetingId: mid2,
				createdBy: OW.id,
			});
			await tx.insert(meetings).values({
				id: mid2,
				workspaceId: wsId,
				title: "ACL porada bez účastníků",
				status: "scheduled",
				hubTaskId: hub2Id,
				transcript: TRANSCRIPT,
				createdBy: OW.id,
			});
		});
		r = await ow.get(`/api/meetings/${mid2}`);
		check("porada bez účastníků: zakladatel přepis dostane (200)", r.status === 200, r.status);
		r = await mem.get(`/api/meetings/${mid2}`);
		check("porada bez účastníků: cizí člen přepis nedostane (403)", r.status === 403, r.status);
	} finally {
		await db.delete(workspaces).where(eq(workspaces.id, wsId));
		for (const u of [OW, PART, INV, MEM, ADM, GST])
			await db.delete(users).where(eq(users.id, u.id));
	}

	if (failed) {
		console.error(`\nMeet ACL integrace: ${failed} SELHALO`);
		process.exit(1);
	}
	console.log("\nMeet ACL integrace: vše prošlo");
	process.exit(0);
}

main().catch(async (e) => {
	console.error(e);
	process.exit(1);
});
