import "./env"; // načte .env (musí být první)
import { serve } from "@hono/node-server";
import {
	and,
	eq,
	getDb,
	memberships,
	ne,
	projectMembers,
	projects,
	sql,
	statuses,
	users,
	workspaces,
} from "@watson/db";
import { DEFAULT_LOCALE, WORKSPACE_ROLES } from "@watson/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { auth } from "./auth";
import { env, googleEnabled, pushEnabled } from "./env";
import { employeeRoutes } from "./employee";
import { exportRoutes } from "./export";
import { meetingsRoutes } from "./meetings";
import { powersyncRoutes } from "./powersync";
import { watsonRoutes } from "./watson";
import { pushRoutes, startReminderWorker } from "./push";
import { rateLimit } from "./rateLimit";

/** Pořadí workspace rolí (R5) pro kontrolu eskalace práv — owner se řeší zvlášť (99). */
const WS_ROLE_RANK: Record<string, number> = {
	guest: 0,
	member: 1,
	manager: 2,
	admin: 3,
};
const roleRank = (r?: string | null): number =>
	(r ? WS_ROLE_RANK[r] : undefined) ?? 0;

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
	await next();
});

// CC-P0-16 — minimální security headers pro JSON API: nosniff, žádné rámování,
// CSP default-src 'none' (API nevrací HTML, ale error/redirect stránky si browser
// jinak interpretuje). HSTS posílá Hono default — na http ho prohlížeč ignoruje.
app.use(
	"/*",
	secureHeaders({
		contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
	}),
);
// CC-P0-16 — globální strop velikosti těla: největší legitimní payload je přepis
// porady (stovky kB); 2 MB stačí všem a zastaví zbytek. Přílohy (M1/F7) dostanou
// vlastní upload endpoint s vlastním limitem.
app.use(
	"/*",
	bodyLimit({
		maxSize: 2 * 1024 * 1024,
		onError: (c) => c.json({ error: "body_too_large" }, 413),
	}),
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
app.use("/api/push/*", rateLimit({ name: "push", windowMs: 60_000, max: 120 }));

app.get("/health", (c) =>
	c.json({
		ok: true,
		service: "watson-api",
		locale: DEFAULT_LOCALE,
		auth: {
			emailPassword: true,
			twoFactor: true,
			magicLink: "dev",
			google: googleEnabled,
		},
		time: new Date().toISOString(),
	}),
);

/** Better Auth — všechny auth endpointy (/api/auth/sign-up, sign-in, two-factor, ...). */
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

/** PowerSync — JWKS, token, write upload. */
app.route("/", powersyncRoutes);
app.route("/", meetingsRoutes);
app.route("/", watsonRoutes);
app.route("/", exportRoutes);

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
			role: memberships.role,
		})
		.from(memberships)
		.innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
		.where(eq(memberships.userId, session.user.id));

	return c.json({ workspaces: rows });
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

	const body = (await c.req.json().catch(() => ({}))) as {
		name?: string;
		workspaceId?: string;
		color?: string;
		kind?: string;
	};
	const name = (body.name ?? "").trim();
	if (!name || !body.workspaceId)
		return c.json({ error: "name and workspaceId required" }, 400);

	const db = getDb();
	// zakladatel musí být členem prostoru (a ne Host)
	const mine = (
		await db
			.select({ role: memberships.role })
			.from(memberships)
			.where(
				and(
					eq(memberships.workspaceId, body.workspaceId),
					eq(memberships.userId, session.user.id),
				),
			)
	)[0];
	if (!mine) return c.json({ error: "forbidden" }, 403);
	if (mine.role === "guest") return c.json({ error: "read-only-host" }, 403);

	const kind =
		body.kind === "goal" || body.kind === "cycle" ? body.kind : "flow";
	const [project] = await db
		.insert(projects)
		.values({
			name,
			workspaceId: body.workspaceId,
			color: body.color ?? null,
			kind,
			ownerId: session.user.id,
		})
		.returning();
	if (!project) return c.json({ error: "insert failed" }, 500);

	await db.insert(projectMembers).values({
		projectId: project.id,
		userId: session.user.id,
		role: "manager",
	});
	// výchozí statusy (Board sloupce, R9)
	await db.insert(statuses).values([
		{
			scope: "project",
			projectId: project.id,
			name: "K udělání",
			position: 0,
			isDone: false,
		},
		{
			scope: "project",
			projectId: project.id,
			name: "Probíhá",
			position: 1,
			isDone: false,
		},
		{
			scope: "project",
			projectId: project.id,
			name: "Hotovo",
			position: 2,
			isDone: true,
		},
	]);

	return c.json({ project });
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
	const body = (await c.req.json().catch(() => ({}))) as {
		areas?: string | null;
		bio?: string | null;
	};

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
	if (Object.keys(patch).length === 0)
		return c.json({ error: "nothing to update" }, 400);

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
	const role = ((await c.req.json().catch(() => ({}))) as { role?: string })
		.role;
	// Validace proti sdílenému enumu WORKSPACE_ROLES (admin/manager/member/guest) — dřív odmítal 'manager'.
	if (!role || !(WORKSPACE_ROLES as readonly string[]).includes(role))
		return c.json({ error: "invalid role" }, 400);

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
 * Pozvat člena do workspace (jen owner/admin/manager): existujícího uživatele podle e-mailu
 * přidá do memberships (roster se hned aktualizuje). Uživatel zatím neexistuje → added:false
 * (skutečná e-mailová pozvánka nováčkovi = mail infra, blok #8).
 */
app.post("/api/workspaces/:id/invite", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const wsId = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) as {
		email?: string;
		role?: string;
	};
	const email = body.email?.trim().toLowerCase();
	if (!email || !email.includes("@"))
		return c.json({ error: "invalid email" }, 400);
	const role =
		body.role && (WORKSPACE_ROLES as readonly string[]).includes(body.role)
			? body.role
			: "member";

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
	if (!user) return c.json({ ok: true, added: false, reason: "no_user" });

	await db
		.insert(memberships)
		.values({ workspaceId: wsId, userId: user.id, role })
		.onConflictDoNothing();
	return c.json({ ok: true, added: true, member: user });
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
		})
		.from(projectMembers)
		.innerJoin(users, eq(projectMembers.userId, users.id))
		.where(eq(projectMembers.projectId, pid));
	return c.json({ members: rows });
});

/** Přidání člena projektu (toggle avatarů v detailu projektu, prototyp ř. 1255–1257). */
app.post("/api/projects/:id/members", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const pid = c.req.param("id");
	const userId = ((await c.req.json().catch(() => ({}))) as { userId?: string })
		.userId;
	if (!userId) return c.json({ error: "userId required" }, 400);

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
