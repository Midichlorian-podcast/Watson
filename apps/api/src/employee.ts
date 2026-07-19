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
import { readLuckyOsV1Identity, readLuckyOsV1Status } from "./employeeSelfService";
import { env, luckyOsEnabled } from "./env";
import {
	employeeStatusSchema,
	isLuckyOsRevoked,
	type LuckyEmployeeStatus,
	luckyFetch,
	luckyIdentitySchema,
	recordLuckyOsHealth,
} from "./integrations";
import { issueBridgeToken } from "./powersync";

type Db = ReturnType<typeof getDb>;
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const employeeRoutes = new Hono<{ Variables: { requestId: string } }>();

employeeRoutes.use("*", async (c, next) => {
	await next();
	c.header("Cache-Control", "private, no-store");
});

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function text(value: unknown, max = 500): string | null {
	return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function finite(value: unknown, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
	return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
		? value
		: null;
}

function relativeHref(value: unknown): string | null {
	const href = text(value, 500);
	return href?.startsWith("/") && !href.startsWith("//") ? href : null;
}

const readinessStates = new Set(["ready", "pending", "blocked"]);
const deadlineSeverities = new Set(["info", "warning", "urgent", "overdue"]);

/**
 * Owner-only veřejná projekce provider stavu. LuckyOS může svůj interní payload
 * rozšiřovat, ale Watson nikdy nevrací neznámá pole, interní identity ani provider metadata.
 */
export function publicEmployeeStatus(value: LuckyEmployeeStatus) {
	const person = object(value.person);
	const readiness = object(value.readiness);
	const deadlines = object(value.deadlines);
	const progress = object((value as JsonObject).dpp_progress);
	const submissions = object((value as JsonObject).submissions);
	const blockers = Array.isArray(readiness.blockers)
		? readiness.blockers.slice(0, 100).map((entry) => {
				const row = object(entry);
				return {
					type: text(row.type, 64) ?? "other",
					explanation: text(row.explanation, 1_000) ?? "Vyžaduje doplnění.",
					href: relativeHref(row.href),
				};
			})
		: [];
	const missingDocuments = Array.isArray(readiness.missing_documents)
		? readiness.missing_documents
				.map((entry) => text(entry, 120))
				.filter((entry): entry is string => Boolean(entry))
				.slice(0, 100)
		: [];
	const countdowns = Array.isArray(deadlines.computed_countdowns)
		? deadlines.computed_countdowns.slice(0, 50).map((entry) => {
				const row = object(entry);
				const severity = text(row.severity, 20);
				return {
					key: text(row.key ?? row.type, 80) ?? "deadline",
					label: text(row.label ?? row.title, 300) ?? "Termín",
					due: text(row.due ?? row.due_date, 40),
					daysRemaining: finite(row.days_remaining, -3_650, 3_650),
					severity: severity && deadlineSeverities.has(severity) ? severity : "info",
				};
			})
		: [];
	const submissionKinds = [
		"attendance",
		"expenses",
		"documents",
		"profile_changes",
		"small_numbers",
	] as const;
	const submissionSummary = Object.fromEntries(
		submissionKinds.map((kind) => {
			const rows = Array.isArray(submissions[kind]) ? submissions[kind] : [];
			return [
				kind,
				rows.slice(0, 20).map((entry) => {
					const row = object(entry);
					return {
						id: text(row.id, 128),
						status: text(row.status ?? row.review_status, 40) ?? "unknown",
						reviewerNote: text(row.reviewer_note, 1_000),
						periodMonth: finite(row.period_month, 1, 12),
						periodYear: finite(row.period_year, 2020, 2100),
						updatedAt: text(row.updated_at ?? row.submitted_at ?? row.created_at, 50),
					};
				}),
			];
		}),
	);
	const rawStatus = text(readiness.status, 20);
	return {
		person: {
			// Provider person ID je serverová identita a může být odvozené z e-mailu.
			// Klient ho pro read-only Hub nepotřebuje a nesmí ho posílat zpět jako autoritu.
			id: null,
			fullName: text(person.full_name, 500),
			personType: text(person.person_type, 100),
		},
		readiness: {
			status: rawStatus && readinessStates.has(rawStatus) ? rawStatus : "pending",
			blockers,
			missingDocuments,
			hasSubmittedAttendance: readiness.has_submitted_attendance === true,
			parentContributionCompleted: readiness.parent_contribution_completed === true,
		},
		deadlines: {
			attendanceDueDay: finite(deadlines.attendance_due_day, 1, 31),
			payrollDay: finite(deadlines.payroll_day, 1, 31),
			withholdingTaxDay: finite(deadlines.withholding_tax_day, 1, 31),
			countdowns,
		},
		dppProgress: {
			hoursUsed: finite(progress.hours_used, 0, 100_000),
			hoursLimit: finite(progress.hours_limit, 0, 100_000),
			monthlyHours: finite(progress.monthly_hours, 0, 10_000),
			monthlyLimit: finite(progress.monthly_limit, 0, 10_000),
		},
		submissions: submissionSummary,
		notifications: (value.notifications ?? []).map((notification) => ({
			id: notification.id,
			type: notification.type,
			title: notification.title,
			message: notification.message ?? null,
			href: relativeHref(notification.href),
			due: notification.due ?? null,
			isRead: notification.is_read ?? false,
		})),
	};
}

function publicEmployeeIdentity(data: unknown) {
	const root = object(data);
	const person = object(root.person);
	return {
		id: null,
		fullName: text(person.full_name, 500),
		personType: text(person.person_type, 100),
	};
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
	if (env.luckyOs.protocol === "v1") {
		const identity = await readLuckyOsV1Identity(session.user.id);
		return c.json(identity, identity.linked ? 200 : identity.reason === "luckyos_contract_rejected" ? 502 : 200);
	}
	const email = session.user.email;
	if (!email) return c.json({ linked: false, reason: "no_email" });

	const res = await luckyFetch(session.user.id, email, null, "/api/employee/me");
	if (!res.ok) {
		return c.json({
			linked: false,
			...(res.revoked ? { status: 423 } : {}),
			reason: res.revoked
				? "luckyos_revoked"
				: res.notConfigured
					? "luckyos_not_configured"
					: res.status === 404
						? "luckyos_identity_not_linked"
						: "luckyos_unavailable",
		});
	}
	const parsed = luckyIdentitySchema.safeParse(res.data);
	if (!parsed.success) {
		return c.json({ linked: false, reason: "luckyos_contract_rejected" }, 502);
	}
	return c.json({ linked: true, person: publicEmployeeIdentity(parsed.data) });
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
	if (env.luckyOs.protocol === "v1") {
		const result = await readLuckyOsV1Status(session.user.id);
		if (!result.ok) {
			return c.json({
				linked: false,
				reason: result.revoked
					? "luckyos_revoked"
					: result.status === 403 || result.status === 404
						? "luckyos_identity_not_linked"
						: result.status === 422
							? "luckyos_contract_rejected"
							: "luckyos_unavailable",
			});
		}
		const parsed = employeeStatusSchema.safeParse(result.data);
		if (!parsed.success) return c.json({ linked: false, reason: "luckyos_contract_rejected" }, 502);
		return c.json({
			linked: true,
			selfService: true,
			status: publicEmployeeStatus(parsed.data),
			fetchedAt: new Date().toISOString(),
		});
	}
	const email = session.user.email;
	if (!email) return c.json({ linked: false, reason: "no_email" });
	const res = await luckyFetch(session.user.id, email, null, "/api/employee/status");
	if (!res.ok) {
		return c.json({
			linked: false,
			reason: res.revoked
				? "luckyos_revoked"
				: res.notConfigured
					? "luckyos_not_configured"
					: res.status === 404
						? "luckyos_identity_not_linked"
						: "luckyos_unavailable",
		});
	}
	const parsed = employeeStatusSchema.safeParse(res.data);
	if (!parsed.success) return c.json({ linked: false, reason: "luckyos_contract_rejected" }, 502);
	return c.json({
		linked: true,
		selfService: false,
		status: publicEmployeeStatus(parsed.data),
		fetchedAt: new Date().toISOString(),
	});
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
	if (env.luckyOs.protocol === "v1") {
		const result = await readLuckyOsV1Status(session.user.id);
		if (result.revoked) return c.json({ linked: false, reason: "luckyos_revoked" }, 423);
		if (!result.ok) return c.json({ linked: false, status: result.status }, 502);
		const parsedStatus = employeeStatusSchema.safeParse(result.data);
		if (!parsedStatus.success) return c.json({ error: "invalid_luckyos_status_payload" }, 502);
		const summary = await reconcileEmployeeTasks(
			session.user.id,
			parsedStatus.data,
			c.get("requestId") ?? null,
		);
		return c.json({ linked: true, ...summary, fetchedAt: new Date().toISOString() });
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
	return c.json({ linked: true, ...summary, fetchedAt: new Date().toISOString() });
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
