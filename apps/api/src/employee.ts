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
	auditEvents,
	entityLinks,
	eq,
	getDb,
	projectMembers,
	projects,
	sql,
	statuses,
	tasks,
	workspaces,
} from "@watson/db";
import { type Context, Hono } from "hono";
import { auth } from "./auth";
import { env, luckyOsEnabled } from "./env";
import {
	employeeStatusSchema,
	isLuckyOsRevoked,
	type LuckyEmployeeStatus,
	luckyFetch,
	recordLuckyOsHealth,
} from "./integrations";
import { issueBridgeToken } from "./powersync";

type Db = ReturnType<typeof getDb>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const employeeRoutes = new Hono<{ Variables: { requestId: string } }>();

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

export type EmployeeStatus = LuckyEmployeeStatus;

/** Osobní workspace uživatele (R8). */
async function personalWorkspaceId(db: DbTx, userId: string): Promise<string | null> {
	const rows = await db
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(and(eq(workspaces.ownerId, userId), eq(workspaces.isPersonal, true)))
		.limit(1);
	return rows[0]?.id ?? null;
}

/** Dedikovaný osobní projekt „Zaměstnanec" (create-if-missing) + členství + výchozí statusy. */
async function ensureEmployeeProject(
	db: DbTx,
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
export async function reconcileEmployeeTasks(
	userId: string,
	status: EmployeeStatus,
	requestId: string | null = null,
) {
	const db = getDb();
	return db.transaction(async (tx) => {
		// Jeden reconcile daného uživatele v jeden okamžik. Chrání create-if-missing
		// projektu i task/link aggregate proti dvěma současným API instancím.
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`employee:${userId}`}, 0))`);
		const wsId = await personalWorkspaceId(tx, userId);
		if (!wsId) return { created: 0, skipped: 0, projectId: null as string | null };
		const projectId = await ensureEmployeeProject(tx, userId, wsId);

		let created = 0;
		let skipped = 0;
		const createdTaskIds: string[] = [];
		for (const notification of status.notifications ?? []) {
			if (!ACTIONABLE_NOTIF.has(notification.type)) continue;
			const link = await tx
				.select({ taskId: entityLinks.fromId })
				.from(entityLinks)
				.where(
					and(
						eq(entityLinks.workspaceId, wsId),
						eq(entityLinks.sourceSystem, "luckyos"),
						eq(entityLinks.externalId, notification.id),
						eq(entityLinks.toType, "luckyos_notification"),
					),
				)
				.limit(1);
			if (link[0]) {
				skipped++;
				continue;
			}
			const due = notification.due
				? new Date(`${notification.due.slice(0, 10)}T00:00:00.000Z`)
				: null;
			const description =
				[notification.message, notification.href ? `Zdroj: LuckyOS (${notification.href})` : null]
					.filter(Boolean)
					.join("\n\n") || null;
			const [task] = await tx
				.insert(tasks)
				.values({
					projectId,
					name: notification.title.slice(0, 500),
					description,
					priority: 2,
					dueDate: due,
					assignmentMode: "single",
					createdBy: userId,
				})
				.returning({ id: tasks.id });
			if (!task) throw new Error("employee_task_insert_failed");
			await tx.insert(assignments).values({ taskId: task.id, projectId, userId });
			await tx.insert(entityLinks).values({
				workspaceId: wsId,
				fromType: "task",
				fromId: task.id,
				toType: "luckyos_notification",
				toId: notification.id,
				relation: "derived_from",
				sourceSystem: "luckyos",
				externalId: notification.id,
			});
			createdTaskIds.push(task.id);
			created++;
		}
		if (created > 0) {
			await tx.insert(auditEvents).values({
				workspaceId: wsId,
				actorType: "user",
				actorUserId: userId,
				entity: "employee_reconcile",
				action: "create_tasks",
				diff: { projectId, createdTaskIds, created, skipped },
				requestId,
			});
		}
		return { created, skipped, projectId };
	});
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

	const res = await luckyFetch(session.user.id, email, null, "/api/employee/me");
	if (!res.ok) {
		return c.json({
			linked: false,
			reason: res.revoked ? "luckyos_revoked" : undefined,
			status: res.status,
		});
	}
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
	const res = await luckyFetch(session.user.id, email, null, "/api/employee/status");
	if (!res.ok) {
		return c.json({
			linked: false,
			reason: res.revoked ? "luckyos_revoked" : undefined,
			status: res.status,
		});
	}
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
	const res = await luckyFetch(session.user.id, email, null, "/api/employee/status");
	if (res.revoked) return c.json({ linked: false, reason: "luckyos_revoked" }, 423);
	if (!res.ok) return c.json({ linked: false, status: res.status }, 502);
	const parsedStatus = employeeStatusSchema.safeParse(res.data);
	if (!parsedStatus.success) return c.json({ error: "invalid_luckyos_status_payload" }, 502);
	const summary = await reconcileEmployeeTasks(
		session.user.id,
		parsedStatus.data,
		c.get("requestId") ?? null,
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

	const res = await luckyFetch(session.user.id, email, null, target, { method, body });
	if (res.revoked) return c.json({ linked: false, reason: "luckyos_revoked" }, 423);
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
	if (await isLuckyOsRevoked(session.user.id)) {
		return c.json({ error: "luckyos_revoked" }, 423);
	}

	if (env.luckyOs.mock && !env.luckyOs.baseUrl) {
		await recordLuckyOsHealth(session.user.id, { ok: true, status: 200 });
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
	let res: Response;
	try {
		res = await fetch(new URL("/api/storage/drive", env.luckyOs.baseUrl), {
			method: "POST",
			signal: AbortSignal.timeout(60_000),
			headers: {
				authorization: `Bearer ${token}`,
				"x-file-storage-mode": "auto",
			},
			body: form,
		});
	} catch (error) {
		await recordLuckyOsHealth(session.user.id, {
			ok: false,
			status: error instanceof Error && error.name === "TimeoutError" ? 504 : 502,
		});
		return c.json(
			{ error: error instanceof Error && error.name === "TimeoutError" ? "luckyos_timeout" : "luckyos_unavailable" },
			error instanceof Error && error.name === "TimeoutError" ? 504 : 502,
		);
	}
	await recordLuckyOsHealth(session.user.id, { ok: res.ok, status: res.status });
	const text = await res.text();
	return new Response(text, {
		status: res.status,
		headers: {
			"content-type": res.headers.get("content-type") ?? "application/json",
		},
	});
});
