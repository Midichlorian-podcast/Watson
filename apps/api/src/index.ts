import "./env"; // načte .env (musí být první)
import { createHmac } from "node:crypto";
import { serve } from "@hono/node-server";
import {
	and,
	auditEvents,
	eq,
	getDb,
	isNull,
	memberships,
	ne,
	projectMembers,
	projectMilestones,
	projects,
	sql,
	statuses,
	users,
	workspaceInvitations,
	workspaces,
} from "@watson/db";
import {
	DEFAULT_LOCALE,
	PROJECT_PRESET_DEFINITIONS,
	PROJECT_PRESETS,
	TASK_CONFLICT_POLICIES,
} from "@watson/shared";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { aiPolicyRoutes } from "./aiPolicy";
import { ATTACHMENT_MAX_BYTES, attachmentRoutes } from "./attachments";
import { auth } from "./auth";
import { chainCommandRoutes } from "./chainCommands";
import { customFieldRoutes } from "./customFields";
import { employeeRoutes } from "./employee";
import { env, googleEnabled, pushEnabled } from "./env";
import { exportRoutes } from "./export";
import { meetingsRoutes } from "./meetings";
import { pollRoutes } from "./polls";
import { powersyncRoutes } from "./powersync";
import { projectMilestoneRoutes } from "./projectMilestones";
import { pushRoutes, startReminderWorker } from "./push";
import { rateLimit } from "./rateLimit";
import { savedViewRoutes } from "./savedViews";
import { taskBulkCommandRoutes } from "./taskBulkCommands";
import { taskCommandRoutes } from "./taskCommands";
import {
	decodeTimelineCursor,
	encodeTimelineCursor,
	mergeTaskTimeline,
	type RawAuditTimelineRow,
	type RawLegacyTimelineRow,
} from "./taskTimeline";
import { watsonRoutes } from "./watson";

/** Pořadí workspace rolí (R5) pro kontrolu eskalace práv — owner se řeší zvlášť (99). */
const WS_ROLE_RANK: Record<string, number> = {
	guest: 0,
	member: 1,
	manager: 2,
	admin: 3,
};
const roleRank = (r?: string | null): number =>
	(r ? WS_ROLE_RANK[r] : undefined) ?? 0;

const uuid = z.string().uuid();
const workspaceRole = z.enum(["admin", "manager", "member", "guest"]);
const createProjectSchema = z
	.object({
		id: uuid.optional(),
		name: z.string().trim().min(1).max(200),
		workspaceId: uuid,
		color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
		kind: z.enum(["flow", "goal", "cycle"]).optional(),
		preset: z.enum(PROJECT_PRESETS).optional().default("blank"),
		milestonesEnabled: z.boolean().optional().default(false),
		defaultMilestoneTitle: z.string().trim().min(1).max(200).optional(),
	})
	.strict();
class ProjectCreateConflict extends Error {}
const memberProfileSchema = z
	.object({
		areas: z.string().trim().max(500).nullable().optional(),
		bio: z.string().trim().max(1000).nullable().optional(),
	})
	.strict()
	.refine((body) => body.areas !== undefined || body.bio !== undefined, "nothing_to_update");
const memberRoleSchema = z.object({ role: workspaceRole }).strict();
const inviteSchema = z
	.object({
		email: z.string().trim().toLowerCase().email().max(254),
		name: z.string().trim().min(1).max(200).optional(),
		role: workspaceRole.optional().default("member"),
	})
	.strict();
const projectMemberSchema = z.object({ userId: uuid }).strict();
const taskConflictPolicySchema = z
	.object({ policy: z.enum(TASK_CONFLICT_POLICIES) })
	.strict();

/**
 * CC-P0-05 — smí volající spravovat ČLENSTVÍ projektu? Rozhodnutí §15/5:
 * project manager, nebo workspace admin/owner. Editor/commenter/member NIKDY.
 * Vrací workspaceId projektu, ať endpointy nedělají druhý lookup.
 */
async function canManageProjectMembers(
	db: ReturnType<typeof getDb>,
	projectId: string,
	userId: string,
): Promise<{ found: boolean; ok: boolean; workspaceId?: string }> {
	const proj = (
		await db
			.select({ workspaceId: projects.workspaceId })
			.from(projects)
			.where(eq(projects.id, projectId))
	)[0];
	if (!proj) return { found: false, ok: false };
	const pm = (
		await db
			.select({ role: projectMembers.role })
			.from(projectMembers)
			.where(
				and(
					eq(projectMembers.projectId, projectId),
					eq(projectMembers.userId, userId),
				),
			)
	)[0];
	if (pm?.role === "manager")
		return { found: true, ok: true, workspaceId: proj.workspaceId };
	const ws = (
		await db
			.select({ ownerId: workspaces.ownerId })
			.from(workspaces)
			.where(eq(workspaces.id, proj.workspaceId))
	)[0];
	if (ws?.ownerId === userId)
		return { found: true, ok: true, workspaceId: proj.workspaceId };
	const m = (
		await db
			.select({ role: memberships.role })
			.from(memberships)
			.where(
				and(
					eq(memberships.workspaceId, proj.workspaceId),
					eq(memberships.userId, userId),
				),
			)
	)[0];
	return { found: true, ok: m?.role === "admin", workspaceId: proj.workspaceId };
}

const app = new Hono<{ Variables: { requestId: string } }>();

// F1 — request ID: každá odpověď nese X-Request-Id a chybové logy ho prefixují,
// takže uživatelské hlášení jde spárovat s konkrétním serverovým záznamem.
app.use("/*", async (c, next) => {
	const rid = crypto.randomUUID().slice(0, 8);
	c.set("requestId", rid);
	c.header("X-Request-Id", rid);
	const started = performance.now();
	await next();
	const durationMs = Math.round((performance.now() - started) * 10) / 10;
	c.header("Server-Timing", `app;dur=${durationMs}`);
	const record = JSON.stringify({
		level: c.res.status >= 500 ? "error" : c.res.status >= 400 ? "warn" : "info",
		event: "http_request",
		requestId: rid,
		method: c.req.method,
		// Nikdy query string: auth callback může nést jednorázový token.
		path: c.req.path,
		status: c.res.status,
		durationMs,
	});
	if (c.res.status >= 500) console.error(record);
	else if (c.res.status >= 400) console.warn(record);
	else if (!c.req.path.startsWith("/health")) console.log(record);
});

// Autentizovaná API data, exporty a meeting obsah se nesmí ocitnout v browser/proxy cache.
app.use("/api/*", async (c, next) => {
	c.header("Cache-Control", "private, no-store, max-age=0");
	c.header("Pragma", "no-cache");
	await next();
});

// CC-P0-16 — minimální security headers pro JSON API: nosniff, žádné rámování,
// CSP default-src 'none' (API nevrací HTML, ale error/redirect stránky si browser
// jinak interpretuje). HSTS posílá Hono default — na http ho prohlížeč ignoruje.
app.use(
	"/*",
	secureHeaders({
		contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
		// Web a API jsou oddělené originy stejného Watson webu. Same-site dovolí
		// autorizované <img> náhledy příloh, ale ne vložení na cizí web.
		crossOriginResourcePolicy: "same-site",
	}),
);
// CC-P0-16 — globální strop velikosti těla: největší legitimní payload je přepis
// porady (stovky kB); 2 MB stačí všem a zastaví zbytek. Přílohy (M1/F7) dostanou
// vlastní upload endpoint s vlastním limitem.
const standardBodyLimit = bodyLimit({
	maxSize: 2 * 1024 * 1024,
	onError: (c) => c.json({ error: "body_too_large" }, 413),
});
const restoreBodyLimit = bodyLimit({
	maxSize: 25 * 1024 * 1024,
	onError: (c) => c.json({ error: "restore_file_too_large", maxBytes: 25 * 1024 * 1024 }, 413),
});
const attachmentBodyLimit = bodyLimit({
	// Multipart hlavičky mají malou režii nad limitem samotného souboru.
	maxSize: ATTACHMENT_MAX_BYTES + 1024 * 1024,
	onError: (c) => c.json({ error: "attachment_too_large", maxBytes: ATTACHMENT_MAX_BYTES }, 413),
});
app.use("/*", (c, next) =>
	c.req.path === "/api/restore"
		? restoreBodyLimit(c, next)
		: c.req.path === "/api/attachments/stage"
			? attachmentBodyLimit(c, next)
			: standardBodyLimit(c, next),
);

app.use(
	"/*",
	cors({
		origin: env.webOrigins,
		credentials: true,
		allowHeaders: ["Content-Type", "Authorization"],
		allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		exposeHeaders: ["X-Request-Id"],
	}),
);

// Rate-limit proti brute-force / spamu. Auth štědře (celý tým se ráno přihlašuje z jedné NAT IP,
// ale 300/15 min přesto zastropuje uhádávání hesel); push subscribe umírněně.
// POZN.: /api/sync/write ZÁMĚRNĚ NElimitujeme per-IP — tým za jednou IP dělá legitimně mnoho zápisů;
// zneužití řeší row-level auth ve write-pathu, ne IP throttling.
app.use("/api/auth/*", rateLimit({ name: "auth", windowMs: 15 * 60_000, max: 300 }));
app.use(
	"/api/push/*",
	rateLimit({ name: "push", windowMs: 60_000, max: 120, scope: "session-or-ip" }),
);
app.use(
	"/api/meetings/*",
	rateLimit({ name: "meetings", windowMs: 60_000, max: 60, scope: "session-or-ip" }),
);
app.use(
	"/api/watson/*",
	rateLimit({ name: "watson-ai", windowMs: 60_000, max: 20, scope: "session-or-ip" }),
);
app.use(
	"/api/employee/*",
	rateLimit({ name: "employee", windowMs: 60_000, max: 120, scope: "session-or-ip" }),
);
app.use(
	"/api/attachments/*",
	rateLimit({ name: "attachments", windowMs: 60_000, max: 60, scope: "session-or-ip" }),
);
app.use(
	"/api/attachment-stages/*",
	rateLimit({ name: "attachment-stages", windowMs: 60_000, max: 120, scope: "session-or-ip" }),
);
app.use(
	"/api/custom-fields/*",
	rateLimit({ name: "custom-fields", windowMs: 60_000, max: 120, scope: "session-or-ip" }),
);
app.use(
	"/api/projects/:projectId/custom-fields",
	rateLimit({ name: "custom-fields-create", windowMs: 60_000, max: 60, scope: "session-or-ip" }),
);

// CC-P0-11 — privilegovaný účet bez 2FA smí číst data a otevřít Nastavení, ale
// v produkčním režimu nesmí provést žádný zápis. Auth endpointy zůstávají volné,
// aby si mohl TOTP zapnout. Kontrola je serverová; skrytí tlačítka v UI nestačí.
app.use("/api/*", async (c, next) => {
	if (
		!env.authRequirePrivileged2FA ||
		["GET", "HEAD", "OPTIONS"].includes(c.req.method) ||
		c.req.path.startsWith("/api/auth/")
	) {
		return next();
	}
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return next();
	const [security] = await getDb()
		.select({
			twoFactorEnabled: users.twoFactorEnabled,
			privileged: sql<boolean>`(
				exists(select 1 from memberships m where m.user_id = ${session.user.id} and m.role = 'admin')
				or exists(select 1 from workspaces w where w.owner_id = ${session.user.id})
			)`,
		})
		.from(users)
		.where(eq(users.id, session.user.id))
		.limit(1);
	if (security?.privileged && !security.twoFactorEnabled) {
		return c.json(
			{
				error: "two_factor_enrollment_required",
				message: "Privilegovaný účet musí před zápisem zapnout dvoufázové ověření.",
				action: "/nastaveni#zabezpeceni",
			},
			403,
		);
	}
	return next();
});

const healthPayload = (database: "up" | "down") => ({
	ok: database === "up",
	service: "watson-api",
	locale: DEFAULT_LOCALE,
	database,
	auth: {
		emailPassword: true,
		emailVerification: true,
		signup: env.authAllowSignup ? "public" : "invite-only",
		twoFactor: {
			available: true,
			privilegedWritesRequired: env.authRequirePrivileged2FA,
		},
		magicLink: env.resendApiKey
			? "email"
			: process.env.DEV_AUTH_LOG_LINKS === "1" && process.env.NODE_ENV !== "production"
				? "explicit-dev-console"
				: "unavailable",
		passwordReset: env.resendApiKey ? "email" : "unavailable",
		google: googleEnabled,
	},
	time: new Date().toISOString(),
});

app.get("/health/live", (c) => {
	c.header("Cache-Control", "no-store");
	return c.json({ ok: true, service: "watson-api", time: new Date().toISOString() });
});

async function readiness(c: Context<{ Variables: { requestId: string } }>) {
	c.header("Cache-Control", "no-store");
	try {
		await getDb().execute(sql`SELECT 1`);
		return c.json(healthPayload("up"));
	} catch {
		return c.json(healthPayload("down"), 503);
	}
}

app.get("/health", readiness);
app.get("/health/ready", readiness);

/** Better Auth — všechny auth endpointy (/api/auth/sign-up, sign-in, two-factor, ...). */
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

/** PowerSync — JWKS, token, write upload. */
app.route("/", powersyncRoutes);
app.route("/", aiPolicyRoutes);
app.route("/", taskCommandRoutes);
app.route("/", taskBulkCommandRoutes);
app.route("/", chainCommandRoutes);
app.route("/", meetingsRoutes);
app.route("/", watsonRoutes);
app.route("/", exportRoutes);
app.route("/", savedViewRoutes);
app.route("/", attachmentRoutes);
app.route("/", customFieldRoutes);
app.route("/", pollRoutes);
app.route("/", projectMilestoneRoutes);

/** Zaměstnanecký modul — broker na LuckyOS employee API (bridge-token). */
app.route("/", employeeRoutes);

/** Web Push — VAPID klíč, (od)hlášení odběru, test. */
app.route("/", pushRoutes);

/** Aktuální uživatel + session. */
app.get("/api/me", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ user: null }, 401);
	return c.json({ user: session.user });
});

/**
 * Per-user klíč pro šifrovanou lokální PowerSync DB. Klíč je deterministický,
 * takže stejný uživatel svou cache otevře i po nové session, ale dva uživatelé
 * nikdy nedostanou stejný klíč. Odpověď je chráněná session cookie a globálním
 * no-store; root secret nikdy neopustí server.
 */
app.get("/api/me/local-data-key", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const root =
		env.localDataEncryptionSecret ??
		"watson-dev-local-data-encryption-secret-not-for-production";
	const key = createHmac("sha256", root)
		.update(`watson-local-db:v1:${session.user.id}`)
		.digest("base64url");
	return c.json({ key, version: 1 });
});

/** Workspaces přihlášeného uživatele (přes membership). */
app.get("/api/workspaces", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);

	const db = getDb();
	const rows = await db
		.select({
			id: workspaces.id,
			name: workspaces.name,
			isPersonal: workspaces.isPersonal,
			color: workspaces.color,
			taskConflictPolicy: workspaces.taskConflictPolicy,
			role: memberships.role,
		})
		.from(memberships)
		.innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
		.where(eq(memberships.userId, session.user.id));

	return c.json({
		workspaces: rows.map((workspace) => {
			const rank = roleRank(workspace.role);
			return {
				...workspace,
				capabilities: {
					manageGoals: rank >= roleRank("manager"),
					manageListTemplates: rank >= roleRank("manager"),
					manageWorkspaceMembers: rank >= roleRank("admin"),
					createContacts: rank >= roleRank("member"),
					createLists: rank >= roleRank("member"),
				},
			};
		}),
	});
});

/** Vedení prostoru nastaví warning/strict reakci na konflikty úkolů. */
app.patch("/api/workspaces/:id/task-conflict-policy", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const workspaceId = c.req.param("id");
	if (!uuid.safeParse(workspaceId).success) return c.json({ error: "invalid_workspace_id" }, 422);
	const parsed = taskConflictPolicySchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_policy" }, 422);

	const db = getDb();
	const result = await db.transaction(async (tx) => {
		const rows = await tx
			.select({ role: memberships.role, ownerId: workspaces.ownerId })
			.from(workspaces)
			.leftJoin(
				memberships,
				and(
					eq(memberships.workspaceId, workspaces.id),
					eq(memberships.userId, session.user.id),
				),
			)
			.where(eq(workspaces.id, workspaceId));
		const access = rows[0];
		if (!access) return { error: "not_found" as const };
		const canManage =
			access.ownerId === session.user.id ||
			access.role === "admin" ||
			access.role === "manager";
		if (!canManage) return { error: "forbidden" as const };

		const [updated] = await tx
			.update(workspaces)
			.set({ taskConflictPolicy: parsed.data.policy, updatedAt: new Date() })
			.where(eq(workspaces.id, workspaceId))
			.returning({ policy: workspaces.taskConflictPolicy });
		await tx.insert(auditEvents).values({
			workspaceId,
			actorUserId: session.user.id,
			entity: "workspaces",
			entityId: workspaceId,
			action: "task_conflict_policy_update",
			diff: { policy: parsed.data.policy },
			requestId: c.get("requestId"),
		});
		return { policy: updated?.policy ?? parsed.data.policy };
	});
	if ("error" in result) {
		return c.json({ error: result.error }, result.error === "not_found" ? 404 : 403);
	}
	return c.json(result);
});

/** Projekty přihlášeného uživatele (přes project membership). */
app.get("/api/projects", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);

	const db = getDb();
	const rows = await db
		.select({
			id: projects.id,
			name: projects.name,
			workspaceId: projects.workspaceId,
			role: projectMembers.role,
		})
		.from(projectMembers)
		.innerJoin(projects, eq(projectMembers.projectId, projects.id))
		.where(eq(projectMembers.userId, session.user.id));

	return c.json({ projects: rows });
});

/** Založení projektu (#15): projekt + členství zakladatele (manager) + výchozí statusy. */
app.post("/api/projects", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);

	const parsed = createProjectSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_project", issues: parsed.error.issues }, 422);
	const body = parsed.data;
	const name = body.name;
	const workspaceId = body.workspaceId;

	const db = getDb();
	// zakladatel musí být členem prostoru (a ne Host)
	const mine = (
		await db
			.select({ role: memberships.role })
			.from(memberships)
			.where(
				and(
					eq(memberships.workspaceId, workspaceId),
					eq(memberships.userId, session.user.id),
				),
			)
	)[0];
	if (!mine) return c.json({ error: "forbidden" }, 403);
	if (mine.role === "guest") return c.json({ error: "read-only-host" }, 403);

	const preset = PROJECT_PRESET_DEFINITIONS[body.preset];
	const kind = body.kind ?? preset.kind;
	const defaultMilestoneTitle = body.defaultMilestoneTitle ?? "Všechny úkoly hotové";
	// CC-P0-07: projekt, manager a výchozí stavy tvoří jediný DB invariant.
	// Dílčí selhání musí vrátit vše a klient nesmí dostat napůl vytvořený projekt.
	try {
		const result = await db.transaction(async (tx) => {
			if (body.id) {
				await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${body.id}))`);
				const existing = (
					await tx.select().from(projects).where(eq(projects.id, body.id))
				)[0];
				if (existing) {
					const existingStatuses = await tx
						.select({ name: statuses.name, position: statuses.position, isDone: statuses.isDone })
						.from(statuses)
						.where(eq(statuses.projectId, existing.id))
						.orderBy(statuses.position);
					const sameStatuses =
						existingStatuses.length === preset.statuses.length &&
						existingStatuses.every(
							(status, index) =>
								status.name === preset.statuses[index]?.name &&
								status.position === index &&
							status.isDone === preset.statuses[index]?.isDone,
						);
					const existingMilestones = await tx
						.select({ title: projectMilestones.title, conditionType: projectMilestones.conditionType })
						.from(projectMilestones)
						.where(eq(projectMilestones.projectId, existing.id));
					const sameMilestones = body.milestonesEnabled
						? existingMilestones.length === 1 &&
							existingMilestones[0]?.title === defaultMilestoneTitle &&
							existingMilestones[0]?.conditionType === "all_tasks_completed"
						: existingMilestones.length === 0;
					if (
						existing.workspaceId !== workspaceId ||
						existing.ownerId !== session.user.id ||
						existing.name !== name ||
						existing.color !== (body.color ?? null) ||
						existing.kind !== kind ||
						existing.defaultLayout !== preset.layout ||
						existing.milestonesEnabled !== body.milestonesEnabled ||
						!sameMilestones ||
						!sameStatuses
					)
						throw new ProjectCreateConflict("project_id_conflict");
					return { project: existing, replayed: true };
				}
			}

			const [created] = await tx
				.insert(projects)
				.values({
					id: body.id,
					name,
					workspaceId,
					color: body.color ?? null,
					kind,
					defaultLayout: preset.layout,
					ownerId: session.user.id,
					milestonesEnabled: body.milestonesEnabled,
				})
				.returning();
			if (!created) throw new Error("project_insert_returned_no_row");

			await tx.insert(projectMembers).values({
				projectId: created.id,
				userId: session.user.id,
				role: "manager",
			});
			await tx.insert(statuses).values(
				preset.statuses.map((status, position) => ({
					scope: "project" as const,
					projectId: created.id,
					name: status.name,
					position,
					isDone: status.isDone,
				})),
			);
			if (body.milestonesEnabled) {
				await tx.insert(projectMilestones).values({
					projectId: created.id,
					title: defaultMilestoneTitle,
					conditionType: "all_tasks_completed",
					createdBy: session.user.id,
				});
			}
			await tx.insert(auditEvents).values({
				workspaceId,
				actorUserId: session.user.id,
				entity: "projects",
				entityId: created.id,
				action: "create",
				diff: {
					name,
					kind,
					preset: body.preset,
					defaultLayout: preset.layout,
					statusCount: preset.statuses.length,
					milestonesEnabled: body.milestonesEnabled,
					defaultMilestoneTitle: body.milestonesEnabled ? defaultMilestoneTitle : null,
				},
				requestId: c.get("requestId"),
			});
			return { project: created, replayed: false };
		});

		return c.json(result, result.replayed ? 200 : 201);
	} catch (error) {
		if (error instanceof ProjectCreateConflict)
			return c.json({ error: "project_id_conflict" }, 409);
		throw error;
	}
});

/**
 * Historie úprav úkolu (audit log) — čte se on-demand z Postgresu (task_activity se NEsyncuje,
 * je insert-only kvůli objemu). Vidí jen člen projektu úkolu; join na users doplní jména autorů.
 */
app.get("/api/tasks/:id/activity", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const taskId = c.req.param("id");
	const db = getDb();
	const rows = await db.execute(sql`
		SELECT a.id, a.field, a.old_value, a.new_value, a.user_id, a.created_at,
		       u.name AS user_name
		FROM task_activity a
		JOIN tasks t ON t.id = a.task_id
		JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ${session.user.id}
		LEFT JOIN users u ON u.id = a.user_id
		WHERE a.task_id = ${taskId}
		ORDER BY a.created_at DESC
		LIMIT 200
	`);
	return c.json({ activity: rows });
});

/**
 * Jednotná časová osa úkolu. Autoritou jsou transakční audit_events; starší
 * task_activity doplňuje pouze události, které v autoritativním auditu chybí.
 * Cursor je stabilní dvojice created_at + globálně prefixované id.
 */
app.get("/api/tasks/:id/timeline", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const taskId = c.req.param("id");
	if (!uuid.safeParse(taskId).success) return c.json({ error: "invalid_task_id" }, 422);
	const limitParsed = z.coerce.number().int().min(10).max(100).default(50).safeParse(c.req.query("limit"));
	if (!limitParsed.success) return c.json({ error: "invalid_limit" }, 422);
	const cursorRaw = c.req.query("cursor") ?? null;
	const cursor = decodeTimelineCursor(cursorRaw);
	if (cursorRaw && !cursor) return c.json({ error: "invalid_cursor" }, 422);

	const db = getDb();
	const access = (await db.execute(sql`
		SELECT t.project_id, p.workspace_id
		FROM tasks t
		JOIN projects p ON p.id = t.project_id
		JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ${session.user.id}
		WHERE t.id = ${taskId}
		LIMIT 1
	`)) as { project_id: string; workspace_id: string }[];
	// 404 neprozrazuje existenci restricted úkolu uživateli mimo projekt.
	if (!access[0]) return c.json({ error: "not_found" }, 404);

	const queryLimit = limitParsed.data * 5 + 1;
	const auditCursor = cursor
		? sql`AND (
			ae.created_at < ${cursor.at}::timestamptz
			OR (ae.created_at = ${cursor.at}::timestamptz AND ('audit:' || ae.id::text) < ${cursor.id})
			)`
		: sql``;
	const legacyCursor = cursor
		? sql`AND (
			ta.created_at < ${cursor.at}::timestamptz
			OR (ta.created_at = ${cursor.at}::timestamptz AND ('legacy:' || ta.id::text) < ${cursor.id})
			)`
		: sql``;

	const auditRows = (await db.execute(sql`
		SELECT ae.id, ae.entity, ae.entity_id, ae.action, ae.diff, ae.before,
		       ae.actor_type, ae.actor_user_id, u.name AS actor_name, ae.created_at
		FROM audit_events ae
		LEFT JOIN users u ON u.id = ae.actor_user_id
		WHERE ae.workspace_id = ${access[0].workspace_id}
		AND (
			(ae.entity = 'tasks' AND ae.entity_id = ${taskId})
			OR (
				ae.entity IN ('assignments', 'comments', 'comment_decisions', 'reminders', 'attachments',
					'task_custom_field_values',
					'task_polls', 'task_poll_responses',
					'task_user_colors', 'task_occurrence_overrides')
				AND COALESCE(ae.diff->>'task_id', ae.before->>'task_id') = ${taskId}
			)
			OR (
				ae.entity = 'task_dependencies'
				AND (
					COALESCE(ae.diff->>'blocking_task_id', ae.before->>'blocking_task_id') = ${taskId}
					OR COALESCE(ae.diff->>'blocked_task_id', ae.before->>'blocked_task_id') = ${taskId}
				)
			)
			OR (
				ae.entity = 'meetings'
				AND (
					ae.diff->>'hubTaskId' = ${taskId}
					OR COALESCE(ae.diff->'taskIds', '[]'::jsonb) ? ${taskId}
					OR COALESCE(ae.diff->'carryTaskIds', '[]'::jsonb) ? ${taskId}
					OR ae.entity_id IN (SELECT m.id FROM meetings m WHERE m.hub_task_id = ${taskId})
				)
			)
			OR (
				ae.entity = 'employee_reconcile'
				AND COALESCE(ae.diff->'createdTaskIds', '[]'::jsonb) ? ${taskId}
			)
			OR (
				ae.entity = 'task_delete_batch'
				AND COALESCE(ae.diff->'rootTaskIds', '[]'::jsonb) ? ${taskId}
			)
		)
		${auditCursor}
		ORDER BY ae.created_at DESC, ('audit:' || ae.id::text) DESC
		LIMIT ${queryLimit}
	`)) as RawAuditTimelineRow[];
	const legacyRows = (await db.execute(sql`
		SELECT ta.id, ta.field, ta.old_value, ta.new_value, ta.user_id,
		       u.name AS user_name, ta.created_at
		FROM task_activity ta
		LEFT JOIN users u ON u.id = ta.user_id
		WHERE ta.task_id = ${taskId}
		${legacyCursor}
		ORDER BY ta.created_at DESC, ('legacy:' || ta.id::text) DESC
		LIMIT ${queryLimit}
	`)) as RawLegacyTimelineRow[];

	const merged = mergeTaskTimeline(auditRows, legacyRows, taskId);
	const events = merged.slice(0, limitParsed.data);
	const mayHaveMore =
		merged.length > limitParsed.data ||
		auditRows.length === queryLimit ||
		legacyRows.length === queryLimit;
	const last = events.at(-1);
	return c.json({
		events,
		nextCursor: mayHaveMore && last ? encodeTimelineCursor(last) : null,
	});
});

/** Členové workspace (jen pro člena) — Nastavení → Tým a role. */
app.get("/api/workspaces/:id/members", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const wsId = c.req.param("id");
	const db = getDb();

	const mine = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(
			and(
				eq(memberships.workspaceId, wsId),
				eq(memberships.userId, session.user.id),
			),
		);
	if (mine.length === 0) return c.json({ error: "forbidden" }, 403);

	const ws = (
		await db
			.select({
				id: workspaces.id,
				name: workspaces.name,
				ownerId: workspaces.ownerId,
			})
			.from(workspaces)
			.where(eq(workspaces.id, wsId))
	)[0];

	const rows = await db
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			image: users.image,
			job: users.jobTitle,
			role: memberships.role,
			// Oblasti + popis role v tomto prostoru (pro AI směrování a přehled admina).
			areas: memberships.areas,
			bio: memberships.bio,
		})
		.from(memberships)
		.innerJoin(users, eq(memberships.userId, users.id))
		.where(eq(memberships.workspaceId, wsId));

	return c.json({
		workspace: ws ?? null,
		members: rows.map((r) => ({ ...r, isOwner: ws?.ownerId === r.id })),
	});
});

/**
 * Úprava profilu člena v prostoru — oblasti odpovědnosti (`areas`) a popis (`bio`).
 * Jen owner/admin/manager (stejný práh jako změna role). Slouží jako podklad pro
 * AI směrování („kdo co řeší") i lidský přehled. Feedback 2026-07-12.
 */
app.patch("/api/workspaces/:id/members/:userId/profile", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const wsId = c.req.param("id");
	const targetId = c.req.param("userId");
	if (!uuid.safeParse(wsId).success || !uuid.safeParse(targetId).success)
		return c.json({ error: "invalid_id" }, 422);
	const parsed = memberProfileSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_profile", issues: parsed.error.issues }, 422);
	const body = parsed.data;

	const db = getDb();
	const ws = (
		await db
			.select({ ownerId: workspaces.ownerId })
			.from(workspaces)
			.where(eq(workspaces.id, wsId))
	)[0];
	const mine = (
		await db
			.select({ role: memberships.role })
			.from(memberships)
			.where(
				and(
					eq(memberships.workspaceId, wsId),
					eq(memberships.userId, session.user.id),
				),
			)
	)[0];
	const callerRank = ws?.ownerId === session.user.id ? 99 : roleRank(mine?.role);
	if (callerRank < roleRank("manager"))
		return c.json({ error: "forbidden" }, 403);

	// Jen dodané klíče (prázdný string → vymazat na null). Oříznuté délky pro rozumné limity.
	const patch: { areas?: string | null; bio?: string | null } = {};
	if ("areas" in body)
		patch.areas = body.areas?.trim() ? body.areas.trim().slice(0, 500) : null;
	if ("bio" in body)
		patch.bio = body.bio?.trim() ? body.bio.trim().slice(0, 1000) : null;

	const updated = await db
		.update(memberships)
		.set(patch)
		.where(
			and(eq(memberships.workspaceId, wsId), eq(memberships.userId, targetId)),
		)
		.returning({ id: memberships.id });
	if (updated.length === 0)
		return c.json({ error: "not a member" }, 404);
	return c.json({ ok: true });
});

/** Změna role člena workspace (jen owner/admin; vlastníkův řádek nelze měnit). */
app.patch("/api/workspaces/:id/members/:userId/role", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const wsId = c.req.param("id");
	const targetId = c.req.param("userId");
	if (!uuid.safeParse(wsId).success || !uuid.safeParse(targetId).success)
		return c.json({ error: "invalid_id" }, 422);
	const parsed = memberRoleSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_role", issues: parsed.error.issues }, 422);
	const role = parsed.data.role;

	const db = getDb();
	const ws = (
		await db
			.select({ ownerId: workspaces.ownerId })
			.from(workspaces)
			.where(eq(workspaces.id, wsId))
	)[0];
	const mine = (
		await db
			.select({ role: memberships.role })
			.from(memberships)
			.where(
				and(
					eq(memberships.workspaceId, wsId),
					eq(memberships.userId, session.user.id),
				),
			)
	)[0];
	const callerRank = ws?.ownerId === session.user.id ? 99 : roleRank(mine?.role);
	if (callerRank < roleRank("manager"))
		return c.json({ error: "forbidden" }, 403);
	if (ws?.ownerId === targetId)
		return c.json({ error: "cannot change owner role" }, 400);
	// Eskalace práv (#5): nelze udělit roli VYŠŠÍ, než má sám volající (manager nesmí vyrobit admina).
	if (roleRank(role) > callerRank)
		return c.json({ error: "cannot grant role above your own" }, 403);

	const target = (
		await db
			.select({ role: memberships.role })
			.from(memberships)
			.where(
				and(eq(memberships.workspaceId, wsId), eq(memberships.userId, targetId)),
			)
	)[0];
	if (!target) return c.json({ error: "not a member" }, 404);
	// CC-P0-05: měnit lze jen uživatele s NIŽŠÍ hodností, než má volající — manager
	// nesmí degradovat admina a admin nesmí přepsat jiného admina (to smí jen owner, rank 99).
	if (roleRank(target.role) >= callerRank)
		return c.json({ error: "cannot change member with same or higher role" }, 403);
	// Poslední admin: degradace by nechala prostor bez správce s membership řádkem
	// (owner je chráněn zvlášť, ale nemusí mít admin membership).
	if (target.role === "admin" && role !== "admin") {
		const otherAdmin = await db
			.select({ id: memberships.id })
			.from(memberships)
			.where(
				and(
					eq(memberships.workspaceId, wsId),
					eq(memberships.role, "admin"),
					ne(memberships.userId, targetId),
				),
			)
			.limit(1);
		if (otherAdmin.length === 0)
			return c.json({ error: "cannot demote last admin" }, 409);
	}

	await db
		.update(memberships)
		.set({ role })
		.where(
			and(eq(memberships.workspaceId, wsId), eq(memberships.userId, targetId)),
		);
	return c.json({ ok: true });
});

/**
 * Pozvat člena do workspace (jen owner/admin/manager). Existující účet se přidá
 * ihned; nový dostane skutečný Better Auth magic link a user.create hook jej po
 * ověření e-mailu atomicky přidá do všech platných pozvánek.
 */
app.post("/api/workspaces/:id/invite", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const wsId = c.req.param("id");
	if (!uuid.safeParse(wsId).success) return c.json({ error: "invalid_id" }, 422);
	const parsed = inviteSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_invite", issues: parsed.error.issues }, 422);
	const { email, name, role } = parsed.data;

	const db = getDb();
	const ws = (
		await db
			.select({ ownerId: workspaces.ownerId })
			.from(workspaces)
			.where(eq(workspaces.id, wsId))
	)[0];
	const mine = (
		await db
			.select({ role: memberships.role })
			.from(memberships)
			.where(
				and(
					eq(memberships.workspaceId, wsId),
					eq(memberships.userId, session.user.id),
				),
			)
	)[0];
	const callerRank = ws?.ownerId === session.user.id ? 99 : roleRank(mine?.role);
	if (callerRank < roleRank("manager"))
		return c.json({ error: "forbidden" }, 403);
	// Eskalace práv (#5): pozvat lze jen s rolí ≤ vlastní.
	if (roleRank(role) > callerRank)
		return c.json({ error: "cannot grant role above your own" }, 403);

	// Existující uživatel dle e-mailu (case-insensitive).
	const user = (
		await db
			.select({ id: users.id, name: users.name, email: users.email })
			.from(users)
			.where(eq(sql`lower(${users.email})`, email))
	)[0];
	if (user) {
		await db.transaction(async (tx) => {
			await tx
				.insert(memberships)
				.values({ workspaceId: wsId, userId: user.id, role })
				.onConflictDoNothing();
			await tx.insert(auditEvents).values({
				workspaceId: wsId,
				actorType: "user",
				actorUserId: session.user.id,
				entity: "membership",
				entityId: user.id,
				action: "invite_existing",
				diff: { role },
				requestId: c.get("requestId") ?? null,
			});
		});
		return c.json({ ok: true, added: true, invited: false, member: user });
	}

	const invitation = await db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${wsId}:${email}`}, 0))`,
		);
		const [prior] = await tx
			.select({ id: workspaceInvitations.id })
			.from(workspaceInvitations)
			.where(
				and(
					eq(workspaceInvitations.workspaceId, wsId),
					eq(workspaceInvitations.email, email),
					isNull(workspaceInvitations.acceptedAt),
					isNull(workspaceInvitations.revokedAt),
				),
			)
			.limit(1);
		const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
		const [row] = prior
			? await tx
					.update(workspaceInvitations)
					.set({ role, invitedBy: session.user.id, expiresAt, updatedAt: new Date() })
					.where(eq(workspaceInvitations.id, prior.id))
					.returning({ id: workspaceInvitations.id })
			: await tx
					.insert(workspaceInvitations)
					.values({ workspaceId: wsId, email, role, invitedBy: session.user.id, expiresAt })
					.returning({ id: workspaceInvitations.id });
		if (!row) throw new Error("workspace_invitation_not_persisted");
		await tx.insert(auditEvents).values({
			workspaceId: wsId,
			actorType: "user",
			actorUserId: session.user.id,
			entity: "workspace_invitation",
			entityId: row.id,
			action: prior ? "resend" : "invite",
			diff: { role, expiresInDays: 7 },
			requestId: c.get("requestId") ?? null,
		});
		return row;
	});

	try {
		await auth.api.signInMagicLink({
			headers: c.req.raw.headers,
			body: {
				email,
				name,
				callbackURL: `${env.webOrigin}/`,
				newUserCallbackURL: `${env.webOrigin}/`,
			},
		});
	} catch {
		return c.json(
			{ error: "invitation_delivery_failed", invitationId: invitation.id },
			502,
		);
	}
	return c.json({ ok: true, added: false, invited: true, invitationId: invitation.id });
});

/** Členové projektu (jen pro člena) — Projekty detail (vlastník + avatary). */
app.get("/api/projects/:id/members", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const pid = c.req.param("id");
	const db = getDb();
	const mine = await db
		.select({ r: projectMembers.role })
		.from(projectMembers)
		.where(
			and(
				eq(projectMembers.projectId, pid),
				eq(projectMembers.userId, session.user.id),
			),
		);
	if (mine.length === 0) return c.json({ error: "forbidden" }, 403);
	const rows = await db
		.select({
			id: users.id,
			name: users.name,
			email: users.email,
			image: users.image,
			role: projectMembers.role,
		})
		.from(projectMembers)
		.innerJoin(users, eq(projectMembers.userId, users.id))
		.where(eq(projectMembers.projectId, pid));
	const management = await canManageProjectMembers(db, pid, session.user.id);
	return c.json({
		members: rows,
		canManage: management.ok,
		canEdit: management.ok || mine[0]?.r === "editor" || mine[0]?.r === "manager",
	});
});

/** Přidání člena projektu (toggle avatarů v detailu projektu, prototyp ř. 1255–1257). */
app.post("/api/projects/:id/members", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const pid = c.req.param("id");
	if (!uuid.safeParse(pid).success) return c.json({ error: "invalid_id" }, 422);
	const parsed = projectMemberSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_project_member", issues: parsed.error.issues }, 422);
	const { userId } = parsed.data;

	const db = getDb();
	// CC-P0-05: členství smí měnit jen project manager nebo workspace admin/owner (§15/5)
	const gate = await canManageProjectMembers(db, pid, session.user.id);
	if (!gate.found) return c.json({ error: "not found" }, 404);
	if (!gate.ok) return c.json({ error: "forbidden" }, 403);

	// cílový uživatel musí být členem prostoru, kterému projekt patří
	const target = await db
		.select({ r: memberships.role })
		.from(memberships)
		.where(
			and(
				eq(memberships.workspaceId, gate.workspaceId as string),
				eq(memberships.userId, userId),
			),
		);
	if (target.length === 0)
		return c.json({ error: "not a workspace member" }, 400);

	await db
		.insert(projectMembers)
		.values({ projectId: pid, userId })
		.onConflictDoNothing();
	return c.json({ ok: true });
});

/** Odebrání člena projektu (toggle avatarů v detailu projektu). */
app.delete("/api/projects/:id/members/:userId", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const pid = c.req.param("id");
	const targetId = c.req.param("userId");

	const db = getDb();
	// CC-P0-05: členství smí měnit jen project manager nebo workspace admin/owner (§15/5)
	const gate = await canManageProjectMembers(db, pid, session.user.id);
	if (!gate.found) return c.json({ error: "not found" }, 404);
	if (!gate.ok) return c.json({ error: "forbidden" }, 403);

	const target = (
		await db
			.select({ role: projectMembers.role })
			.from(projectMembers)
			.where(
				and(
					eq(projectMembers.projectId, pid),
					eq(projectMembers.userId, targetId),
				),
			)
	)[0];
	// idempotence: nebyl členem → nic k odebrání
	if (!target) return c.json({ ok: true });
	// poslední project manager nesmí zmizet — projekt bez managera je známý dluh (13 kusů),
	// který se nesmí dál prohlubovat; nejdřív povyš jiného člena.
	if (target.role === "manager") {
		const otherManager = await db
			.select({ id: projectMembers.id })
			.from(projectMembers)
			.where(
				and(
					eq(projectMembers.projectId, pid),
					eq(projectMembers.role, "manager"),
					ne(projectMembers.userId, targetId),
				),
			)
			.limit(1);
		if (otherManager.length === 0)
			return c.json({ error: "cannot remove last manager" }, 409);
	}

	await db
		.delete(projectMembers)
		.where(
			and(
				eq(projectMembers.projectId, pid),
				eq(projectMembers.userId, targetId),
			),
		);
	return c.json({ ok: true });
});

// CC-P0-16: poslední bezpečnostní síť všech rout. Odpověď ani log nesmí nést
// request body, SQL, parametry, stack či error.message (mohou obsahovat osobní data).
app.onError((err, c) => {
	const requestId = c.get("requestId") ?? crypto.randomUUID().slice(0, 8);
	const rawCode = (err as { code?: unknown; cause?: { code?: unknown } }).code ??
		(err as { cause?: { code?: unknown } }).cause?.code;
	const code = typeof rawCode === "string" && /^[0-9A-Za-z_]{1,64}$/.test(rawCode)
		? rawCode
		: null;
	console.error(JSON.stringify({
		level: "error",
		event: "unhandled_api_error",
		requestId,
		name: err.name,
		code,
	}));
	return c.json({ error: "internal_error", requestId }, 500);
});

serve({ fetch: app.fetch, port: env.apiPort }, (info) => {
	console.log(`[watson-api] běží na http://localhost:${info.port}`);
	console.log(
		`[watson-api] Google login: ${googleEnabled ? "zapnut" : "vypnut (chybí klíče)"}`,
	);
	console.log(
		`[watson-api] Web Push: ${pushEnabled ? "zapnut" : "vypnut (chybí VAPID klíče)"}`,
	);
	startReminderWorker();
});

export type AppType = typeof app;
