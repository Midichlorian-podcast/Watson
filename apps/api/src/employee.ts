/**
 * Zaměstnanecký broker Watson ↔ LuckyOS („LuckyOS Bridge").
 *
 * Prohlížeč mluví JEN s tímto modulem (same-origin, Better Auth session). Broker drží
 * krátkodobý bridge-token a volá LuckyOS employee API **server-to-server** — tím se obchází
 * same-origin blokáda LuckyOS (cílí na prohlížeče, ne na server-server volání). Bridge-token
 * nikdy neopustí server.
 *
 * Plán: files/ZAMESTNANEC_integracni_PLAN_2026-07-12.md §3.
 * Spec pro LuckyOS: files/ZAMESTNANEC_LUCKYOS_pozadavky_2026-07-12.md §1.
 *
 * Fáze 0 = jen `GET /api/employee/me` (health mostu + „jsem napojený zaměstnanec?"), na jehož
 * `linked` klient gatuje zobrazení modulu. Čtecí/zápisové routy přijdou ve Fázi 1/2.
 */
import {
	and,
	assignments,
	entityLinks,
	eq,
	getDb,
	projectMembers,
	projects,
	statuses,
	tasks,
	workspaces,
} from "@watson/db";
import { type Context, Hono } from "hono";
import { auth } from "./auth";
import { env, luckyOsEnabled } from "./env";
import { issueBridgeToken } from "./powersync";

type Db = ReturnType<typeof getDb>;

export const employeeRoutes = new Hono();

interface LuckyResult {
	ok: boolean;
	status: number;
	data: unknown;
	/** LuckyOS není nakonfigurován (chybí base URL i mock). */
	notConfigured?: boolean;
}

/**
 * Zavolá LuckyOS employee API jménem přihlášeného (bridge-token v `Authorization`).
 * Dev bez reálného LuckyOS: `LUCKYOS_MOCK=1` → canned data, bez sítě i bez tokenu.
 */
async function luckyFetch(
	email: string,
	personId: string | null,
	path: string,
	init?: RequestInit,
): Promise<LuckyResult> {
	if (env.luckyOs.mock && !env.luckyOs.baseUrl) {
		return { ok: true, status: 200, data: mockLucky(email, path, init?.method ?? "GET") };
	}
	if (!env.luckyOs.baseUrl) {
		return { ok: false, status: 503, data: null, notConfigured: true };
	}
	const token = await issueBridgeToken({ email, personId });
	const res = await fetch(new URL(path, env.luckyOs.baseUrl), {
		...init,
		headers: {
			"content-type": "application/json",
			...(init?.headers ?? {}),
			authorization: `Bearer ${token}`,
		},
	});
	let data: unknown = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}
	return { ok: res.ok, status: res.status, data };
}

/** Canned odpovědi pro dev bez LuckyOS (`LUCKYOS_MOCK=1`). */
function mockLucky(email: string, path: string, method: string): unknown {
	if (path.startsWith("/api/employee/me")) {
		return {
			user: { email, role: "employee" },
			person: {
				id: `mock-${email}`,
				full_name: "Trenér (mock)",
				person_type: "dpp",
			},
		};
	}
	if (path.startsWith("/api/employee/status")) {
		return {
			person: {
				id: `mock-${email}`,
				full_name: "Trenér (mock)",
				person_type: "dpp",
			},
			readiness: {
				status: "blocked",
				blockers: [
					{
						type: "missing_bank_account",
						explanation: "Doplň číslo účtu pro výplatu.",
						href: "/employee/profile",
					},
				],
				missing_documents: ["dpp_contract"],
			},
			deadlines: { attendance_due_day: 10, payroll_day: 15 },
			notifications: [
				{
					id: "mock-att-2026-07",
					type: "attendance_reminder",
					title: "Odevzdej docházku za červenec",
					message: "Uzávěrka do 10. 7.",
					href: "/employee/attendance",
					due: "2026-07-10",
					is_read: false,
				},
				{
					id: "mock-bank",
					type: "missing_bank_account",
					title: "Doplň číslo účtu",
					message: "Bez čísla účtu nelze vyplatit mzdu.",
					href: "/employee/profile",
					is_read: false,
				},
				{
					id: "mock-payroll-ready",
					type: "payroll_ready",
					title: "Výplata připravena",
					message: "Červnová výplata je připravena k náhledu.",
					href: "/employee/payroll",
					is_read: false,
				},
			],
		};
	}
	// Odevzdávací/čtecí routy (Fáze 2) — canned odpovědi ve tvaru LuckyOS.
	if (path.startsWith("/api/employee/attendance")) {
		return { ok: true, saved: 0, submission: { status: "submitted" } };
	}
	if (path.startsWith("/api/employee/expenses")) {
		return method === "POST" ? { claim: { status: "submitted" } } : { claims: [] };
	}
	if (path.startsWith("/api/employee/documents")) {
		return method === "POST"
			? { document: { review_status: "pending" } }
			: { documents: [] };
	}
	if (path.startsWith("/api/employee/profile-change")) {
		return method === "POST" ? { request: { status: "pending" } } : { requests: [] };
	}
	if (path.startsWith("/api/employee/small-numbers")) {
		return method === "POST"
			? { entry: { status: "submitted" } }
			: { choreographies: [], entries: [] };
	}
	return {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconcile: notifikace/deadliny LuckyOS → nativní Watson úkoly (Fáze 1)
// ─────────────────────────────────────────────────────────────────────────────

/** Osobní projekt (dedikovaný), kam padají úkoly odvozené z LuckyOS. */
const EMPLOYEE_PROJECT_NAME = "Zaměstnanec";

/**
 * Typy notifikací, které se mají stát AKČNÍM Watson úkolem (něco se musí udělat). Ostatní
 * (payroll_ready, attendance_approved, contract_signed) jsou jen informativní → do úkolů nejdou
 * (zobrazí se v dashboardu „Můj stav"). Odpovídá reálným typům LuckyOS `buildEmployeeNotifications`.
 */
const ACTIONABLE_NOTIF = new Set([
	"attendance_reminder",
	"missing_bank_account",
	"missing_document",
	"attendance_rejected",
	"payroll_blocked",
	"contract_signature_required",
]);

interface StatusNotif {
	id: string;
	type: string;
	title: string;
	message?: string;
	href?: string;
	/** Volitelný termín (ISO YYYY-MM-DD) — stane se termínem úkolu. */
	due?: string | null;
	is_read?: boolean;
}
export interface EmployeeStatus {
	person?: { id?: string; full_name?: string; person_type?: string };
	readiness?: unknown;
	deadlines?: unknown;
	notifications?: StatusNotif[];
}

/** Osobní workspace uživatele (R8). */
async function personalWorkspaceId(db: Db, userId: string): Promise<string | null> {
	const rows = await db
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(and(eq(workspaces.ownerId, userId), eq(workspaces.isPersonal, true)))
		.limit(1);
	return rows[0]?.id ?? null;
}

/** Dedikovaný osobní projekt „Zaměstnanec" (create-if-missing) + členství + výchozí statusy. */
async function ensureEmployeeProject(
	db: Db,
	userId: string,
	wsId: string,
): Promise<string> {
	const existing = await db
		.select({ id: projects.id })
		.from(projects)
		.where(
			and(
				eq(projects.workspaceId, wsId),
				eq(projects.name, EMPLOYEE_PROJECT_NAME),
			),
		)
		.limit(1);
	if (existing[0]) return existing[0].id;

	const [proj] = await db
		.insert(projects)
		.values({
			workspaceId: wsId,
			name: EMPLOYEE_PROJECT_NAME,
			defaultLayout: "list",
			ownerId: userId,
		})
		.returning({ id: projects.id });
	if (!proj) throw new Error("nelze založit projekt Zaměstnanec");
	await db
		.insert(projectMembers)
		.values({ projectId: proj.id, userId, role: "manager" })
		.onConflictDoNothing();
	await db.insert(statuses).values([
		{ scope: "project", projectId: proj.id, name: "K udělání", position: 0, isDone: false },
		{ scope: "project", projectId: proj.id, name: "Probíhá", position: 1, isDone: false },
		{ scope: "project", projectId: proj.id, name: "Hotovo", position: 2, isDone: true },
	]);
	return proj.id;
}

/**
 * Idempotentně převede AKČNÍ notifikace LuckyOS na Watson úkoly v osobním projektu „Zaměstnanec".
 * Dedup přes `entity_links(source_system='luckyos', external_id, to_type='luckyos_notification')`
 * — opětovný pull nezaloží duplikát a EXISTUJÍCÍ úkol NEpřepisuje (respektuje uživatelovu kopii,
 * invariant „zpětné stavy = read-only zrcadlo"; živý stav se čte přes GET /api/employee/status).
 */
export async function reconcileEmployeeTasks(userId: string, status: EmployeeStatus) {
	const db = getDb();
	const wsId = await personalWorkspaceId(db, userId);
	if (!wsId) return { created: 0, skipped: 0, projectId: null as string | null };
	const projectId = await ensureEmployeeProject(db, userId, wsId);

	let created = 0;
	let skipped = 0;
	for (const n of status.notifications ?? []) {
		if (!ACTIONABLE_NOTIF.has(n.type)) continue;

		const link = await db
			.select({ taskId: entityLinks.fromId })
			.from(entityLinks)
			.where(
				and(
					eq(entityLinks.sourceSystem, "luckyos"),
					eq(entityLinks.externalId, n.id),
					eq(entityLinks.toType, "luckyos_notification"),
				),
			)
			.limit(1);
		if (link[0]) {
			skipped++;
			continue;
		}

		const due = n.due ? new Date(n.due) : null;
		const desc =
			[n.message, n.href ? `Zdroj: LuckyOS (${n.href})` : null]
				.filter(Boolean)
				.join("\n\n") || null;

		const [task] = await db
			.insert(tasks)
			.values({
				projectId,
				name: n.title.slice(0, 500),
				description: desc,
				priority: 2,
				dueDate: due,
				assignmentMode: "single",
				createdBy: userId,
			})
			.returning({ id: tasks.id });
		if (!task) continue;

		await db
			.insert(assignments)
			.values({ taskId: task.id, projectId, userId })
			.onConflictDoNothing();
		await db
			.insert(entityLinks)
			.values({
				workspaceId: wsId,
				fromType: "task",
				fromId: task.id,
				toType: "luckyos_notification",
				toId: n.id,
				relation: "derived_from",
				sourceSystem: "luckyos",
				externalId: n.id,
			})
			.onConflictDoNothing();
		created++;
	}
	return { created, skipped, projectId };
}

/**
 * Health mostu + „jsem napojený zaměstnanec?". Klient podle `linked` rozhodne, zda zobrazit
 * (gated) modul Zaměstnanec. 401 bez session; jinak vždy 200 s `linked` (fail-soft — když
 * LuckyOS není nakonfigurován nebo osoba není napárovaná, modul se prostě nezobrazí).
 */
employeeRoutes.get("/api/employee/me", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	if (!luckyOsEnabled) {
		return c.json({ linked: false, reason: "luckyos_not_configured" });
	}
	const email = session.user.email;
	if (!email) return c.json({ linked: false, reason: "no_email" });

	const res = await luckyFetch(email, null, "/api/employee/me");
	if (!res.ok) return c.json({ linked: false, status: res.status });
	const data = res.data as { user?: unknown; person?: unknown };
	return c.json({ linked: true, user: data.user ?? null, person: data.person ?? null });
});

/**
 * Stav zaměstnance z LuckyOS (readiness, blokery, termíny, notifikace) — jen čtení, zdroj pro
 * dashboard „Můj stav". Fáze 1. Kontrakt zdroje: files/ZAMESTNANEC_LUCKYOS_pozadavky §2.
 */
employeeRoutes.get("/api/employee/status", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	if (!luckyOsEnabled) {
		return c.json({ linked: false, reason: "luckyos_not_configured" });
	}
	const email = session.user.email;
	if (!email) return c.json({ linked: false, reason: "no_email" });
	const res = await luckyFetch(email, null, "/api/employee/status");
	if (!res.ok) return c.json({ linked: false, status: res.status });
	return c.json({ linked: true, status: res.data });
});

/**
 * Sync: stáhne stav z LuckyOS a idempotentně z akčních notifikací vyrobí Watson úkoly v osobním
 * projektu „Zaměstnanec" (dedup přes entity_links). Úkol = jen připomínka; skutečné odevzdání
 * dělá zaměstnanec ve formuláři (Fáze 2). Human-in-the-loop se neruší.
 */
employeeRoutes.post("/api/employee/sync", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	if (!luckyOsEnabled) {
		return c.json({ linked: false, reason: "luckyos_not_configured" });
	}
	const email = session.user.email;
	if (!email) return c.json({ linked: false, reason: "no_email" });
	const res = await luckyFetch(email, null, "/api/employee/status");
	if (!res.ok) return c.json({ linked: false, status: res.status }, 502);
	const summary = await reconcileEmployeeTasks(
		session.user.id,
		res.data as EmployeeStatus,
	);
	return c.json({ linked: true, ...summary });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fáze 2 — odevzdávací passthrough (broker 1:1 na LuckyOS employee API)
// ─────────────────────────────────────────────────────────────────────────────

/** Whitelist rout, které broker proxuje 1:1 na LuckyOS (žádná jiná cesta není povolená). */
const PASSTHROUGH: { method: "GET" | "POST"; path: string }[] = [
	{ method: "POST", path: "/api/employee/attendance" },
	{ method: "GET", path: "/api/employee/expenses" },
	{ method: "POST", path: "/api/employee/expenses" },
	{ method: "GET", path: "/api/employee/documents" },
	{ method: "POST", path: "/api/employee/documents" },
	{ method: "GET", path: "/api/employee/profile-change" },
	{ method: "POST", path: "/api/employee/profile-change" },
	{ method: "GET", path: "/api/employee/small-numbers" },
	{ method: "POST", path: "/api/employee/small-numbers" },
];

/**
 * Proxy JSON požadavku na LuckyOS employee API (bridge-token, server-to-server). Status z LuckyOS
 * se ZACHOVÁ (klient vidí 400/403/409 z legislativní validace). person_id + odevzdávací status
 * vynucuje LuckyOS z tokenu; broker nic nemění (invarianty §5). Idempotence = stabilní klientské
 * `id` v těle (LuckyOS upsert); retry řeší klient (offline draft).
 */
async function forward(
	c: Context,
	method: "GET" | "POST",
	path: string,
): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	if (!luckyOsEnabled) {
		return c.json({ linked: false, reason: "luckyos_not_configured" }, 503);
	}
	const email = session.user.email;
	if (!email) return c.json({ linked: false, reason: "no_email" }, 400);

	const target = method === "GET" ? path + new URL(c.req.url).search : path;
	const body =
		method === "POST"
			? JSON.stringify(await c.req.json().catch(() => ({})))
			: undefined;

	const res = await luckyFetch(email, null, target, { method, body });
	return new Response(JSON.stringify(res.data ?? {}), {
		status: res.ok ? 200 : res.status,
		headers: { "content-type": "application/json" },
	});
}

for (const r of PASSTHROUGH) {
	if (r.method === "GET") {
		employeeRoutes.get(r.path, (c) => forward(c, "GET", r.path));
	} else {
		employeeRoutes.post(r.path, (c) => forward(c, "POST", r.path));
	}
}

/**
 * Upload souboru na LuckyOS Drive (multipart) — bajty jdou přes broker (bridge-token +
 * `x-file-storage-mode: auto`). Vrací refs (storage_file_id, sha256…), které klient pošle do
 * employee metadata routy. Citlivé soubory NIKDY do týmového úložiště — jen průchod na LuckyOS.
 */
employeeRoutes.post("/api/employee/storage/drive", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	if (!luckyOsEnabled) return c.json({ error: "luckyos_not_configured" }, 503);
	const email = session.user.email;
	if (!email) return c.json({ error: "no_email" }, 400);

	if (env.luckyOs.mock && !env.luckyOs.baseUrl) {
		return c.json({
			file: {
				storage_file_id: `mock-${crypto.randomUUID()}`,
				provider: "mock",
				file_sha256: "mock",
			},
		});
	}
	if (!env.luckyOs.baseUrl) return c.json({ error: "luckyos_not_configured" }, 503);

	const form = await c.req.formData();
	const token = await issueBridgeToken({ email, personId: null });
	const res = await fetch(new URL("/api/storage/drive", env.luckyOs.baseUrl), {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"x-file-storage-mode": "auto",
		},
		body: form,
	});
	const text = await res.text();
	return new Response(text, {
		status: res.status,
		headers: {
			"content-type": res.headers.get("content-type") ?? "application/json",
		},
	});
});
